const db = require('../config/db');

exports.getWallet = async (userId) => {
    let [wallets] = await db.query('SELECT * FROM wallets WHERE user_id = ?', [userId]);
    if (wallets.length === 0) {
        const [result] = await db.execute('INSERT INTO wallets (user_id, balance) VALUES (?, 0)', [userId]);
        return { id: result.insertId, user_id: userId, balance: 0 };
    }
    return wallets[0];
};

exports.addTransaction = async (userId, type, entity, entityId, amount, description) => {
    const wallet = await exports.getWallet(userId);
    
    // Add transaction
    await db.execute(
        'INSERT INTO transactions (wallet_id, type, entity, entity_id, amount, description) VALUES (?, ?, ?, ?, ?, ?)',
        [wallet.id, type, entity, entityId, amount, description]
    );

    // Update balance
    if (type === 'credit') {
        await db.execute('UPDATE wallets SET balance = balance + ? WHERE id = ?', [amount, wallet.id]);
    } else if (type === 'debit') {
        // Guard against negative balance
        const [cur] = await db.query('SELECT balance FROM wallets WHERE id = ?', [wallet.id]);
        if (cur[0] && parseFloat(cur[0].balance) < parseFloat(amount)) {
            console.warn(`⚠️ Wallet ${wallet.id}: Attempted debit ₹${amount} but balance is only ₹${cur[0].balance}. Clamping to zero.`);
        }
        await db.execute('UPDATE wallets SET balance = GREATEST(0, balance - ?) WHERE id = ?', [amount, wallet.id]);
    }
};

exports.getWalletDetails = async (req, res) => {
    const userId = req.user.id;
    try {
        const wallet = await exports.getWallet(userId);
        const [transactions] = await db.query('SELECT * FROM transactions WHERE wallet_id = ? ORDER BY created_at DESC LIMIT 50', [wallet.id]);
        
        // Pending payouts sum
        let pendingPayouts = 0;
        let pendingDonations = [];
        try {
            const [pending] = await db.query(
                `SELECT d.id, d.estimated_value, d.items_summary, d.created_at, d.status,
                        p.id as pickup_id, n.name as ngo_name
                 FROM donations d
                 LEFT JOIN pickups p ON d.pickup_id = p.id
                 LEFT JOIN ngos n ON d.ngo_id = n.id
                 WHERE d.vendor_id = ? AND d.status = 'pending'
                 ORDER BY d.created_at DESC`,
                [userId]
            );
            pendingDonations = pending;
            pendingPayouts = pending.reduce((sum, d) => sum + parseFloat(d.estimated_value || 0), 0);
            console.log(`📊 [DEBUG] Wallet for User ${userId}: Pending Payouts = ₹${pendingPayouts} (${pending.length} records)`);
        } catch (sumErr) {
            console.error('❌ PENDING PAYOUT SUM ERROR:', sumErr.message);
        }
        
        res.json({ balance: wallet.balance, transactions, pendingPayouts, pendingDonations });
    } catch (err) {
        console.error('❌ GET WALLET DETAILS ERROR:', err);
        res.status(500).json({ error: err.message });
    }
};

exports.getAllWallets = async (req, res) => {
    try {
        const [wallets] = await db.query(`
            SELECT w.*, u.phone, u.role, v.business_name 
            FROM wallets w 
            JOIN users u ON w.user_id = u.id 
            LEFT JOIN vendors v ON u.id = v.user_id
            ORDER BY w.balance DESC
        `);
        res.json(wallets);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
