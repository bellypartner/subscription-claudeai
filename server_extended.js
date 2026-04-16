const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'salad_caffe_secret_key_2026';

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Initialize Database
console.log('📦 Initializing database...');
const db = new Database('./salad_caffe.db');
db.pragma('journal_mode = WAL');

initializeDatabase();

function initializeDatabase() {
    try {
        // Users
        db.exec(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            authority TEXT DEFAULT 'customer',
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Categories
        db.exec(`CREATE TABLE IF NOT EXISTS meal_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Meal Items
        db.exec(`CREATE TABLE IF NOT EXISTS meal_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category_id INTEGER NOT NULL,
            veg_tag INTEGER DEFAULT 0,
            non_veg_tag INTEGER DEFAULT 0,
            description TEXT,
            calories INTEGER,
            weight TEXT,
            mrp DECIMAL(10, 2),
            prep_time_minutes INTEGER,
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(category_id) REFERENCES meal_categories(id)
        )`);

        // Territories
        db.exec(`CREATE TABLE IF NOT EXISTS territories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Kitchens
        db.exec(`CREATE TABLE IF NOT EXISTS kitchens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            territory_id INTEGER NOT NULL,
            address TEXT,
            capacity INTEGER,
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(territory_id) REFERENCES territories(id)
        )`);

        // Subscription Plans
        db.exec(`CREATE TABLE IF NOT EXISTS subscription_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            duration_days INTEGER,
            num_deliveries INTEGER,
            diet_type TEXT,
            price DECIMAL(10, 2),
            meal_selection TEXT,
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        console.log('✅ Database initialized successfully');

        // Insert sample user
        try {
            const hashedPassword = bcrypt.hashSync('password123', 10);
            db.prepare(`INSERT OR IGNORE INTO users (name, email, password, authority) 
                       VALUES (?, ?, ?, ?)`).run('Super Admin', 'super@test.com', hashedPassword, 'super_admin');
            console.log('✅ Sample user created');
        } catch (err) {
            console.log('ℹ️ Sample user already exists');
        }

    } catch (err) {
        console.error('❌ Database init error:', err.message);
    }
}

// ==================== MIDDLEWARE ====================

function verifyToken(req, res, next) {
    try {
        const token = req.headers['authorization']?.split(' ')[1];
        if (!token) {
            return res.status(403).json({ error: 'Token required' });
        }
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
}

// ==================== AUTH ====================

app.post('/api/auth/login', (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        
        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, authority: user.authority },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                authority: user.authority
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});

// ==================== CATEGORIES ====================

app.get('/api/admin/categories', verifyToken, (req, res) => {
    try {
        const categories = db.prepare('SELECT * FROM meal_categories WHERE status = "active"').all();
        res.json(categories || []);
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/categories', verifyToken, (req, res) => {
    try {
        const { name, description } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'Name required' });
        }

        const result = db.prepare(
            'INSERT INTO meal_categories (name, description) VALUES (?, ?)'
        ).run(name, description || '');

        res.status(201).json({ message: 'Category created', categoryId: result.lastInsertRowid });
    } catch (err) {
        console.error('Error:', err);
        res.status(400).json({ error: err.message });
    }
});

// ==================== MEAL ITEMS ====================

app.get('/api/admin/meal-items', verifyToken, (req, res) => {
    try {
        const items = db.prepare(`
            SELECT m.*, c.name as category_name 
            FROM meal_items m 
            LEFT JOIN meal_categories c ON m.category_id = c.id 
            WHERE m.status = "active"
        `).all();
        res.json(items || []);
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/meal-items', verifyToken, (req, res) => {
    try {
        const { name, category_id, veg_tag, non_veg_tag, description, calories, weight, mrp, prep_time_minutes } = req.body;
        
        if (!name || !category_id) {
            return res.status(400).json({ error: 'Name and category required' });
        }

        const result = db.prepare(`
            INSERT INTO meal_items 
            (name, category_id, veg_tag, non_veg_tag, description, calories, weight, mrp, prep_time_minutes) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(name, category_id, veg_tag ? 1 : 0, non_veg_tag ? 1 : 0, description || '', calories || 0, weight || '', mrp || 0, prep_time_minutes || 0);

        res.status(201).json({ message: 'Meal item created', mealItemId: result.lastInsertRowid });
    } catch (err) {
        console.error('Error:', err);
        res.status(400).json({ error: err.message });
    }
});

// ==================== TERRITORIES ====================

app.get('/api/admin/territories', verifyToken, (req, res) => {
    try {
        const territories = db.prepare('SELECT * FROM territories WHERE status = "active"').all();
        res.json(territories || []);
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/territories', verifyToken, (req, res) => {
    try {
        const { name, description } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'Name required' });
        }

        const result = db.prepare(
            'INSERT INTO territories (name, description) VALUES (?, ?)'
        ).run(name, description || '');

        res.status(201).json({ message: 'Territory created', territoryId: result.lastInsertRowid });
    } catch (err) {
        console.error('Error:', err);
        res.status(400).json({ error: err.message });
    }
});

// ==================== KITCHENS ====================

app.get('/api/admin/kitchens', verifyToken, (req, res) => {
    try {
        const kitchens = db.prepare(`
            SELECT k.*, t.name as territory_name 
            FROM kitchens k 
            LEFT JOIN territories t ON k.territory_id = t.id 
            WHERE k.status = "active"
        `).all();
        res.json(kitchens || []);
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/kitchens', verifyToken, (req, res) => {
    try {
        const { name, territory_id, address, capacity } = req.body;
        
        if (!name || !territory_id) {
            return res.status(400).json({ error: 'Name and territory required' });
        }

        const result = db.prepare(
            'INSERT INTO kitchens (name, territory_id, address, capacity) VALUES (?, ?, ?, ?)'
        ).run(name, territory_id, address || '', capacity || 100);

        res.status(201).json({ message: 'Kitchen created', kitchenId: result.lastInsertRowid });
    } catch (err) {
        console.error('Error:', err);
        res.status(400).json({ error: err.message });
    }
});

// ==================== SUBSCRIPTION PLANS ====================

app.get('/api/admin/subscription-plans', verifyToken, (req, res) => {
    try {
        const plans = db.prepare('SELECT * FROM subscription_plans WHERE status = "active"').all();
        res.json(plans || []);
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/subscription-plans', verifyToken, (req, res) => {
    try {
        const { name, duration_days, num_deliveries, diet_type, price, meal_selection } = req.body;
        
        if (!name || !duration_days || !num_deliveries || !diet_type || !price) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const result = db.prepare(`
            INSERT INTO subscription_plans 
            (name, duration_days, num_deliveries, diet_type, price, meal_selection) 
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(name, duration_days, num_deliveries, diet_type, price, meal_selection || '');

        res.status(201).json({ message: 'Plan created', planId: result.lastInsertRowid });
    } catch (err) {
        console.error('Error:', err);
        res.status(400).json({ error: err.message });
    }
});

// ==================== HEALTH CHECK ====================

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'connected'
    });
});

// ==================== STATIC FILES ====================

let indexHtml = '';
try {
    indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    console.log('✅ Loaded index.html');
} catch (err) {
    console.warn('⚠️ Could not load index.html:', err.message);
    indexHtml = '<h1>Salad Caffe API</h1><p>Frontend not loaded</p>';
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(indexHtml);
});

app.all('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
        return next();
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(indexHtml);
});

// ==================== ERROR HANDLER ====================

app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
});

// ==================== START SERVER ====================

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📍 Visit: http://localhost:${PORT}`);
});

module.exports = app;
