require('dotenv').config();

const express      = require('express');
const cookieParser = require('cookie-parser');
const helmet       = require('helmet');
const cors         = require('cors');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');

const app  = express();
const PORT = process.env.PORT || 3000;  // Railway injects PORT

/* Security */
app.use(helmet());

/* CORS — allow GitHub Pages frontend with credentials (cookies) */
const ALLOWED = [
  'https://mohamedhasbini.github.io',
  'http://localhost:8080',
  'http://localhost:3000',
];
app.use(cors({
  origin: function(origin, cb) {
    if (!origin || ALLOWED.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

/* Routes */
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);

/* Health check — Railway uses this */
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

/* Global error handler */
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: 'An unexpected error occurred.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[ADS Tech Backend] Port ${PORT} — ${process.env.NODE_ENV || 'development'}`);
});
