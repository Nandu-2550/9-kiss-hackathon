const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/stock_dashboard';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_change_me';
const FRONTEND_URL = process.env.FRONTEND_URL || '';

const allowedOrigins = new Set([
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
]);

if (FRONTEND_URL) {
  FRONTEND_URL
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .forEach((origin) => allowedOrigins.add(origin));
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser clients and same-origin requests with no Origin header.
      if (!origin) {
        return callback(null, true);
      }
      if (allowedOrigins.has(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
  })
);
app.use(express.json());

mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
  })
  .catch((error) => {
    console.error('MongoDB connection error:', error.message);
  });

const watchlistSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    note: {
      type: String,
      default: '',
      trim: true,
    },
    summary: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true }
);

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

const Watchlist = mongoose.model('Watchlist', watchlistSchema);
const User = mongoose.model('User', userSchema);

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

const buildMockMarketData = (symbol) => {
  const seed = symbol
    .split('')
    .reduce((total, char) => total + char.charCodeAt(0), 0);

  const basePrice = 90 + (seed % 220);
  const sparkline = Array.from({ length: 12 }, (_, index) => {
    const wave = Math.sin((seed + index) / 3) * 3;
    const drift = index * 0.35;
    return Number((basePrice + wave + drift).toFixed(2));
  });

  const currentPrice = sparkline[sparkline.length - 1];
  const firstPrice = sparkline[0];
  const changePercent = Number((((currentPrice - firstPrice) / firstPrice) * 100).toFixed(2));

  return {
    symbol,
    price: currentPrice,
    changePercent,
    trend: changePercent >= 0 ? 'up' : 'down',
    sparkline,
    source: 'mock',
  };
};

const normalizeBullets = (text) => {
  const cleaned = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^[-*•]\s*/, ''));

  const picked = cleaned.slice(0, 3);
  while (picked.length < 3) {
    picked.push('No additional insight available.');
  }
  return picked;
};

const buildLocalSummary = (text) => {
  const parts = text
    .split(/[.!?]/)
    .map((part) => part.trim())
    .filter(Boolean);

  const bullets = [
    parts[0] || `Main topic: ${text.slice(0, 80)}`,
    parts[1] || 'Key consideration: track notable events and trend changes.',
    parts[2] || 'Action item: review this note against recent market movement.',
  ];
  return bullets.slice(0, 3);
};

const summarizeWithOpenAI = async (text, apiKey) => {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: 'Summarize user text into exactly 3 concise bullet points.',
        },
        { role: 'user', content: text },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error('OpenAI request failed');
  }

  const payload = await response.json();
  const summaryText = payload?.choices?.[0]?.message?.content ?? '';
  return normalizeBullets(summaryText);
};

const summarizeWithGemini = async (text, apiKey) => {
  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: `Summarize the following text into exactly 3 concise bullet points:\n\n${text}`,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error('Gemini request failed');
  }

  const payload = await response.json();
  const summaryText = payload?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return normalizeBullets(summaryText);
};

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password || password.length < 6) {
      return res.status(400).json({ message: 'Valid email and password (min 6 chars) are required.' });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({ message: 'Email already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ email: email.toLowerCase(), password: hashedPassword });
    const token = jwt.sign({ userId: user._id.toString(), email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    return res.status(201).json({
      token,
      user: { id: user._id.toString(), email: user.email },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Signup failed.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const token = jwt.sign({ userId: user._id.toString(), email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    return res.status(200).json({
      token,
      user: { id: user._id.toString(), email: user.email },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Login failed.' });
  }
});

app.get('/api/watchlist', authMiddleware, async (req, res) => {
  try {
    const items = await Watchlist.find({ userId: req.user.userId }).sort({ createdAt: -1 });
    res.status(200).json(items);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch watchlist items' });
  }
});

app.post('/api/watchlist', authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Stock name is required' });
    }

    const newItem = await Watchlist.create({
      name: name.trim(),
      userId: req.user.userId,
      note: '',
      summary: [],
    });
    return res.status(201).json(newItem);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to save watchlist item' });
  }
});

app.put('/api/watchlist/:id/note', authMiddleware, async (req, res) => {
  try {
    const { note } = req.body;
    const updatedItem = await Watchlist.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.userId },
      { note: typeof note === 'string' ? note.trim() : '' },
      { new: true }
    );

    if (!updatedItem) {
      return res.status(404).json({ message: 'Watchlist item not found' });
    }

    return res.status(200).json(updatedItem);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to save note' });
  }
});

app.delete('/api/watchlist/:id', authMiddleware, async (req, res) => {
  try {
    const deletedItem = await Watchlist.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.userId,
    });

    if (!deletedItem) {
      return res.status(404).json({ message: 'Watchlist item not found' });
    }

    return res.status(200).json({ message: 'Watchlist item deleted' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to delete watchlist item' });
  }
});

app.get('/api/market/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=5m&range=1d`;
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(200).json(buildMockMarketData(symbol));
    }

    const payload = await response.json();
    const result = payload?.chart?.result?.[0];
    const closes = result?.indicators?.quote?.[0]?.close ?? [];
    const validPrices = closes.filter((value) => typeof value === 'number');

    if (!result || validPrices.length < 2) {
      return res.status(200).json(buildMockMarketData(symbol));
    }

    const currentPrice = validPrices[validPrices.length - 1];
    const firstPrice = validPrices[0];
    const changePercent = Number((((currentPrice - firstPrice) / firstPrice) * 100).toFixed(2));

    return res.status(200).json({
      symbol,
      price: Number(currentPrice.toFixed(2)),
      changePercent,
      trend: changePercent >= 0 ? 'up' : 'down',
      sparkline: validPrices.slice(-12).map((value) => Number(value.toFixed(2))),
      source: 'yahoo',
    });
  } catch (error) {
    const symbol = req.params.symbol.toUpperCase();
    return res.status(200).json(buildMockMarketData(symbol));
  }
});

app.post('/api/ai-summary', authMiddleware, async (req, res) => {
  try {
    const { stockId, text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ message: 'Note text is required.' });
    }
    if (!stockId) {
      return res.status(400).json({ message: 'stockId is required.' });
    }

    const watchItem = await Watchlist.findOne({ _id: stockId, userId: req.user.userId });
    if (!watchItem) {
      return res.status(404).json({ message: 'Watchlist item not found.' });
    }

    const openAiKey = process.env.OPENAI_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    let bullets = [];
    let provider = 'local-fallback';

    if (openAiKey) {
      bullets = await summarizeWithOpenAI(text, openAiKey);
      provider = 'openai';
    } else if (geminiKey) {
      bullets = await summarizeWithGemini(text, geminiKey);
      provider = 'gemini';
    } else {
      bullets = buildLocalSummary(text);
    }

    watchItem.note = text.trim();
    watchItem.summary = bullets;
    await watchItem.save();

    return res.status(200).json({ bullets, provider, stockId });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to generate summary.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
