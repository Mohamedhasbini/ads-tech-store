const router  = require('express').Router();
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const pool    = require('../db');

const SALT_ROUNDS = 12;
const OTP_TTL_MS  = 10 * 60 * 1000;

function generateOtp() {
  return crypto.randomInt(100_000, 999_999).toString();
}

async function sendOtpEmail(email, otp) {
  // Plug in SendGrid / Resend / Nodemailer here
  // For now, logs to Railway console so you can test
  console.log(`[OTP] ${email} → ${otp}`);
}

function issueToken(res, user) {
  const token = jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.cookie('token', token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'none',   // 'none' required for cross-origin GitHub Pages → Railway
    maxAge:   7 * 24 * 60 * 60 * 1000,
  });
  return token;
}

/* POST /api/auth/signup */
router.post('/signup', async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name?.trim() || !email?.trim() || !password)
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  if (!/\S+@\S+\.\S+/.test(email))
    return res.status(400).json({ error: 'Invalid email address.' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0)
      return res.status(409).json({ error: 'An account with this email already exists.' });

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const otp          = generateOtp();
    const otpExpires   = new Date(Date.now() + OTP_TTL_MS);

    await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, otp_code, token_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [name.trim(), email.toLowerCase(), phone || null, passwordHash, otp, otpExpires]
    );

    await sendOtpEmail(email, otp);
    return res.status(201).json({ message: 'Account created. Check your email for the verification code.' });
  } catch (err) {
    console.error('[signup]', err.message);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

/* POST /api/auth/verify */
router.post('/verify', async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required.' });

  try {
    const result = await pool.query(
      `SELECT id, name, email, otp_code, token_expires_at, is_verified FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Account not found.' });

    const user = result.rows[0];
    if (user.is_verified) return res.status(400).json({ error: 'Account is already verified.' });
    if (new Date() > new Date(user.token_expires_at))
      return res.status(400).json({ error: 'Code expired. Please request a new one.' });

    const a = Buffer.from(user.otp_code.padStart(6, '0'));
    const b = Buffer.from(String(otp).padStart(6, '0'));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
      return res.status(400).json({ error: 'Incorrect verification code.' });

    await pool.query(
      `UPDATE users SET is_verified = TRUE, otp_code = NULL, token_expires_at = NULL WHERE id = $1`,
      [user.id]
    );

    issueToken(res, user);
    return res.json({ message: 'Account verified.', user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error('[verify]', err.message);
    return res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
});

/* POST /api/auth/login */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  try {
    const result = await pool.query(
      `SELECT id, name, email, password_hash, is_verified FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );
    const GENERIC = 'Invalid email or password.';
    if (result.rows.length === 0) {
      await bcrypt.hash(password, SALT_ROUNDS); // timing-safe dummy
      return res.status(401).json({ error: GENERIC });
    }

    const user  = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: GENERIC });

    if (!user.is_verified)
      return res.status(403).json({ error: 'Email not verified.', requiresVerification: true, email: user.email });

    issueToken(res, user);
    return res.json({ user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error('[login]', err.message);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

/* POST /api/auth/logout */
router.post('/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'none',
  });
  return res.json({ message: 'Signed out.' });
});

/* POST /api/auth/resend-otp */
router.post('/resend-otp', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  try {
    const result = await pool.query(`SELECT id, is_verified FROM users WHERE email = $1`, [email.toLowerCase()]);
    if (result.rows.length === 0 || result.rows[0].is_verified)
      return res.json({ message: 'If an unverified account exists, a new code has been sent.' });

    const otp        = generateOtp();
    const otpExpires = new Date(Date.now() + OTP_TTL_MS);
    await pool.query(`UPDATE users SET otp_code = $1, token_expires_at = $2 WHERE email = $3`,
      [otp, otpExpires, email.toLowerCase()]);
    await sendOtpEmail(email, otp);
    return res.json({ message: 'New code sent.' });
  } catch (err) {
    console.error('[resend-otp]', err.message);
    return res.status(500).json({ error: 'Could not resend code.' });
  }
});

module.exports = router;
