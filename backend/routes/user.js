const router      = require('express').Router();
const requireAuth = require('../middleware/auth');
const pool        = require('../db');

/* GET /api/user/profile */
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, phone, created_at FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) {
      res.clearCookie('token');
      return res.status(404).json({ error: 'User not found.' });
    }
    return res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('[profile]', err.message);
    return res.status(500).json({ error: 'Could not retrieve profile.' });
  }
});

module.exports = router;
