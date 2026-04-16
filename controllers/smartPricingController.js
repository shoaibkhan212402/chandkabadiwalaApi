const db = require('../config/db');

exports.getDynamicSuggestions = async (req, res) => {
    try {
        const [items] = await db.query('SELECT id, name, rate as current_rate, unit FROM scrap_items');
        
        // Simulating an AI Engine analysis of dynamic rates based on market trends
        // If we had external market APIs, we'd fetch them here.
        // For now, we dynamically calculate a suggested +- variance.
        const suggestions = items.map(item => {
            const variancePercent = (Math.random() * 10 - 5); // -5% to +5%
            const suggestedRate = item.current_rate + (item.current_rate * (variancePercent / 100));
            
            return {
                ...item,
                suggested_rate: parseFloat(suggestedRate.toFixed(2)),
                trend: variancePercent > 0 ? 'up' : 'down',
                confidence: parseFloat((Math.random() * 20 + 80).toFixed(1)) + '%' // 80% to 100%
            };
        });

        // Filter only those whose suggested rate deviates by more than 2% to recommend action
        const actionableSuggestions = suggestions.filter(s => Math.abs(s.current_rate - s.suggested_rate) / s.current_rate > 0.02);

        res.json({
            success: true,
            last_analyzed: new Date(),
            recommendations: actionableSuggestions.sort((a,b) => Math.abs(b.current_rate - b.suggested_rate) - Math.abs(a.current_rate - a.suggested_rate))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
