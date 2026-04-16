const db = require('../config/db');

exports.getVendorLeaderboard = async (req, res) => {
    try {
        const [vendors] = await db.query(`
            SELECT u.id, u.name, v.business_name, 
                   COUNT(p.id) as total_pickups, 
                   SUM(p.final_amount) as total_earnings
            FROM users u
            JOIN vendors v ON u.id = v.user_id
            LEFT JOIN pickups p ON u.id = p.vendor_id AND p.status = 'completed'
            WHERE u.role = 'vendor' AND u.status = 'active'
            GROUP BY u.id
            ORDER BY total_pickups DESC, total_earnings DESC
            LIMIT 10
        `);
        res.json({ success: true, leaderboard: vendors });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getDonorLeaderboard = async (req, res) => {
    try {
        const [donors] = await db.query(`
            SELECT u.id, u.name, 
                   COUNT(p.id) as total_donations, 
                   SUM(p.final_amount) as total_donated_value
            FROM users u
            JOIN pickups p ON u.id = p.user_id
            WHERE p.type = 'donate' AND p.status = 'completed'
            GROUP BY u.id
            ORDER BY total_donated_value DESC, total_donations DESC
            LIMIT 10
        `);
        res.json({ success: true, leaderboard: donors });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
