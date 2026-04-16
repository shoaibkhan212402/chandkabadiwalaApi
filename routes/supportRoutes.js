const express = require('express');
const router = express.Router();
const db = require('../config/db');
const auth = require('../middleware/authMiddleware');

// Get my tickets
router.get('/my-tickets', auth(), async (req, res) => {
    try {
        const [tickets] = await db.query('SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
        res.json(tickets);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create a new support ticket
router.post('/create', auth(), async (req, res) => {
    const { subject, message, priority = 'medium' } = req.body;
    if (!subject || !message) return res.status(400).json({ error: 'Subject and message are required' });

    try {
        const [result] = await db.execute(
            'INSERT INTO support_tickets (user_id, subject, message, priority, status) VALUES (?, ?, ?, ?, ?)',
            [req.user.id, subject, message, priority, 'open']
        );
        res.status(201).json({ success: true, ticketId: result.insertId, message: 'Support ticket raised successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get all tickets (Admin)
router.get('/all', auth(['admin']), async (req, res) => {
    try {
        const [tickets] = await db.query(`
            SELECT s.*, u.phone, u.role
            FROM support_tickets s 
            JOIN users u ON s.user_id = u.id 
            ORDER BY s.created_at DESC
        `);
        res.json(tickets);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update ticket status / Reply (Admin)
router.post('/update/:id', auth(['admin']), async (req, res) => {
    const { status, admin_reply } = req.body;
    const ticketId = req.params.id;

    try {
        await db.execute(
            'UPDATE support_tickets SET status = ?, admin_reply = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [status || 'resolved', admin_reply || '', ticketId]
        );
        res.json({ success: true, message: 'Ticket updated successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
