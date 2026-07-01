const router = require('express').Router();
const pool   = require('../db');

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* GET /api/search?q=<query>&limit=12&cat=laptop */
router.get('/', async (req, res) => {
  const raw   = (req.query.q || '').trim();
  const limit = Math.min(parseInt(req.query.limit) || 12, 40);
  const cat   = req.query.cat || '';

  if (!raw || raw.length < 2)
    return res.json({ products: [], query: raw, total: 0 });

  const q = normalize(raw);

  try {
    // Use pg_trgm similarity + full-text ts_rank for scored fuzzy search.
    // Falls back gracefully if pg_trgm isn't installed (ILIKE only).
    const catClause = cat ? `AND category ILIKE $3` : '';
    const params    = cat ? [q, limit, `%${cat}%`] : [q, limit];

    const sql = `
      WITH ranked AS (
        SELECT
          id, brand, name, specs, price, img, category, slug,
          (
            similarity(lower(brand || ' ' || name || ' ' || COALESCE(specs,'')), $1) * 10
            + CASE WHEN lower(brand) LIKE '%' || $1 || '%' THEN 5 ELSE 0 END
            + CASE WHEN lower(name)  LIKE '%' || $1 || '%' THEN 4 ELSE 0 END
            + CASE WHEN lower(COALESCE(specs,'')) LIKE '%' || $1 || '%' THEN 2 ELSE 0 END
          ) AS score
        FROM products
        WHERE is_active = TRUE ${catClause}
          AND (
            lower(brand || ' ' || name || ' ' || COALESCE(specs,'')) LIKE '%' || $1 || '%'
            OR similarity(lower(brand || ' ' || name || ' ' || COALESCE(specs,'')), $1) > 0.12
          )
      )
      SELECT id, brand, name, specs, price, img, category, slug
      FROM ranked
      WHERE score > 0
      ORDER BY score DESC
      LIMIT $2
    `;

    const result = await pool.query(sql, params);

    // Build facets from results
    const brands = {}, cats = {};
    result.rows.forEach(p => {
      brands[p.brand] = (brands[p.brand] || 0) + 1;
      cats[p.category] = (cats[p.category] || 0) + 1;
    });

    return res.json({
      products: result.rows,
      total:    result.rows.length,
      query:    raw,
      facets:   { brands, categories: cats },
    });

  } catch (err) {
    // Fallback: pure ILIKE if pg_trgm not enabled
    console.error('[search] pg_trgm error, falling back to ILIKE:', err.message);
    try {
      const tokens = q.split(/\s+/).filter(t => t.length >= 2);
      const conditions = tokens.map((t, i) =>
        `lower(brand || ' ' || name || ' ' || COALESCE(specs,'')) LIKE $${i+1}`
      );
      const params = tokens.map(t => `%${t}%`);
      params.push(limit);
      const catSql = cat ? `AND category ILIKE '%${cat.replace(/'/g,"''")}%'` : '';
      const fallback = await pool.query(
        `SELECT id,brand,name,specs,price,img,category,slug FROM products
         WHERE is_active=TRUE ${catSql}
         ${conditions.length ? 'AND ('+conditions.join(' OR ')+')' : ''}
         LIMIT $${params.length}`,
        params
      );
      return res.json({ products: fallback.rows, total: fallback.rows.length, query: raw });
    } catch (e2) {
      console.error('[search] fallback failed:', e2.message);
      return res.status(500).json({ error: 'Search unavailable.', products: [] });
    }
  }
});

/* GET /api/search/popular — top 8 items for empty-state / homepage */
router.get('/popular', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id,brand,name,specs,price,img,category,slug
       FROM products WHERE is_active=TRUE ORDER BY sort_order ASC, id ASC LIMIT 8`
    );
    return res.json({ products: result.rows });
  } catch (err) {
    return res.json({ products: [] });
  }
});

module.exports = router;
