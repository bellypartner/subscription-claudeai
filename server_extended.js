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

        // Customers
        db.exec(`CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            phone TEXT,
            address TEXT,
            territory_id INTEGER,
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(territory_id) REFERENCES territories(id)
        )`);

        // Orders
        db.exec(`CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            plan_id INTEGER NOT NULL,
            kitchen_id INTEGER,
            start_date DATE,
            end_date DATE,
            total_amount DECIMAL(10,2),
            paid_amount DECIMAL(10,2) DEFAULT 0,
            payment_status TEXT DEFAULT 'pending',
            order_status TEXT DEFAULT 'active',
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(customer_id) REFERENCES customers(id),
            FOREIGN KEY(plan_id) REFERENCES subscription_plans(id),
            FOREIGN KEY(kitchen_id) REFERENCES kitchens(id)
        )`);

        // Deliveries
        db.exec(`CREATE TABLE IF NOT EXISTS deliveries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            customer_id INTEGER NOT NULL,
            kitchen_id INTEGER,
            delivery_date DATE NOT NULL,
            meal_type TEXT DEFAULT 'lunch',
            status TEXT DEFAULT 'pending',
            delivery_agent TEXT,
            delivered_at DATETIME,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(order_id) REFERENCES orders(id),
            FOREIGN KEY(customer_id) REFERENCES customers(id),
            FOREIGN KEY(kitchen_id) REFERENCES kitchens(id)
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
        if (!token) return res.status(403).json({ error: 'Token required' });
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
        if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

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
            user: { id: user.id, name: user.name, email: user.email, authority: user.authority }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});

// ==================== DASHBOARD STATS ====================

app.get('/api/admin/stats', verifyToken, (req, res) => {
    try {
        const totalCustomers = db.prepare('SELECT COUNT(*) as count FROM customers WHERE status = "active"').get();
        const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get();
        const activeOrders = db.prepare('SELECT COUNT(*) as count FROM orders WHERE order_status = "active"').get();
        const totalRevenue = db.prepare('SELECT COALESCE(SUM(paid_amount), 0) as total FROM orders').get();
        const pendingDeliveries = db.prepare('SELECT COUNT(*) as count FROM deliveries WHERE status = "pending" AND delivery_date = date("now")').get();
        const todayDeliveries = db.prepare('SELECT COUNT(*) as count FROM deliveries WHERE delivery_date = date("now")').get();
        const totalMeals = db.prepare('SELECT COUNT(*) as count FROM meal_items WHERE status = "active"').get();
        const totalPlans = db.prepare('SELECT COUNT(*) as count FROM subscription_plans WHERE status = "active"').get();

        // Recent orders
        const recentOrders = db.prepare(`
            SELECT o.*, c.name as customer_name, p.name as plan_name 
            FROM orders o
            LEFT JOIN customers c ON o.customer_id = c.id
            LEFT JOIN subscription_plans p ON o.plan_id = p.id
            ORDER BY o.created_at DESC LIMIT 5
        `).all();

        // Revenue by month (last 6 months)
        const revenueByMonth = db.prepare(`
            SELECT strftime('%Y-%m', created_at) as month, 
                   SUM(paid_amount) as revenue,
                   COUNT(*) as orders
            FROM orders
            WHERE created_at >= date('now', '-6 months')
            GROUP BY month ORDER BY month
        `).all();

        res.json({
            totalCustomers: totalCustomers.count,
            totalOrders: totalOrders.count,
            activeOrders: activeOrders.count,
            totalRevenue: totalRevenue.total,
            pendingDeliveries: pendingDeliveries.count,
            todayDeliveries: todayDeliveries.count,
            totalMeals: totalMeals.count,
            totalPlans: totalPlans.count,
            recentOrders,
            revenueByMonth
        });
    } catch (err) {
        console.error('Stats error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ==================== CATEGORIES ====================

app.get('/api/admin/categories', verifyToken, (req, res) => {
    try {
        const categories = db.prepare('SELECT * FROM meal_categories WHERE status = "active" ORDER BY created_at DESC').all();
        res.json(categories || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/categories', verifyToken, (req, res) => {
    try {
        const { name, description } = req.body;
        if (!name) return res.status(400).json({ error: 'Name required' });
        const result = db.prepare('INSERT INTO meal_categories (name, description) VALUES (?, ?)').run(name, description || '');
        res.status(201).json({ message: 'Category created', categoryId: result.lastInsertRowid });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.delete('/api/admin/categories/:id', verifyToken, (req, res) => {
    try {
        db.prepare('UPDATE meal_categories SET status = "inactive" WHERE id = ?').run(req.params.id);
        res.json({ message: 'Category deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== MEAL ITEMS ====================

app.get('/api/admin/meal-items', verifyToken, (req, res) => {
    try {
        const items = db.prepare(`
            SELECT m.*, c.name as category_name 
            FROM meal_items m 
            LEFT JOIN meal_categories c ON m.category_id = c.id 
            WHERE m.status = "active" ORDER BY m.created_at DESC
        `).all();
        res.json(items || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/meal-items', verifyToken, (req, res) => {
    try {
        const { name, category_id, veg_tag, non_veg_tag, description, calories, weight, mrp, prep_time_minutes } = req.body;
        if (!name || !category_id) return res.status(400).json({ error: 'Name and category required' });
        const result = db.prepare(`
            INSERT INTO meal_items (name, category_id, veg_tag, non_veg_tag, description, calories, weight, mrp, prep_time_minutes) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(name, category_id, veg_tag ? 1 : 0, non_veg_tag ? 1 : 0, description || '', calories || 0, weight || '', mrp || 0, prep_time_minutes || 0);
        res.status(201).json({ message: 'Meal item created', mealItemId: result.lastInsertRowid });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.delete('/api/admin/meal-items/:id', verifyToken, (req, res) => {
    try {
        db.prepare('UPDATE meal_items SET status = "inactive" WHERE id = ?').run(req.params.id);
        res.json({ message: 'Meal deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== TERRITORIES ====================

app.get('/api/admin/territories', verifyToken, (req, res) => {
    try {
        const territories = db.prepare('SELECT * FROM territories WHERE status = "active" ORDER BY created_at DESC').all();
        res.json(territories || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/territories', verifyToken, (req, res) => {
    try {
        const { name, description } = req.body;
        if (!name) return res.status(400).json({ error: 'Name required' });
        const result = db.prepare('INSERT INTO territories (name, description) VALUES (?, ?)').run(name, description || '');
        res.status(201).json({ message: 'Territory created', territoryId: result.lastInsertRowid });
    } catch (err) {
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
            WHERE k.status = "active" ORDER BY k.created_at DESC
        `).all();
        res.json(kitchens || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/kitchens', verifyToken, (req, res) => {
    try {
        const { name, territory_id, address, capacity } = req.body;
        if (!name || !territory_id) return res.status(400).json({ error: 'Name and territory required' });
        const result = db.prepare('INSERT INTO kitchens (name, territory_id, address, capacity) VALUES (?, ?, ?, ?)').run(name, territory_id, address || '', capacity || 100);
        res.status(201).json({ message: 'Kitchen created', kitchenId: result.lastInsertRowid });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// ==================== SUBSCRIPTION PLANS ====================

app.get('/api/admin/subscription-plans', verifyToken, (req, res) => {
    try {
        const plans = db.prepare('SELECT * FROM subscription_plans WHERE status = "active" ORDER BY created_at DESC').all();
        res.json(plans || []);
    } catch (err) {
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
            INSERT INTO subscription_plans (name, duration_days, num_deliveries, diet_type, price, meal_selection) 
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(name, duration_days, num_deliveries, diet_type, price, meal_selection || '');
        res.status(201).json({ message: 'Plan created', planId: result.lastInsertRowid });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.delete('/api/admin/subscription-plans/:id', verifyToken, (req, res) => {
    try {
        db.prepare('UPDATE subscription_plans SET status = "inactive" WHERE id = ?').run(req.params.id);
        res.json({ message: 'Plan deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== CUSTOMERS ====================

app.get('/api/admin/customers', verifyToken, (req, res) => {
    try {
        const customers = db.prepare(`
            SELECT c.*, t.name as territory_name,
                   COUNT(o.id) as total_orders
            FROM customers c
            LEFT JOIN territories t ON c.territory_id = t.id
            LEFT JOIN orders o ON o.customer_id = c.id
            WHERE c.status = "active"
            GROUP BY c.id
            ORDER BY c.created_at DESC
        `).all();
        res.json(customers || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/customers', verifyToken, (req, res) => {
    try {
        const { name, email, phone, address, territory_id } = req.body;
        if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
        const result = db.prepare(`
            INSERT INTO customers (name, email, phone, address, territory_id) 
            VALUES (?, ?, ?, ?, ?)
        `).run(name, email, phone || '', address || '', territory_id || null);
        res.status(201).json({ message: 'Customer created', customerId: result.lastInsertRowid });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.put('/api/admin/customers/:id', verifyToken, (req, res) => {
    try {
        const { name, email, phone, address, territory_id, status } = req.body;
        db.prepare(`
            UPDATE customers SET name=?, email=?, phone=?, address=?, territory_id=?, status=? WHERE id=?
        `).run(name, email, phone || '', address || '', territory_id || null, status || 'active', req.params.id);
        res.json({ message: 'Customer updated' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.delete('/api/admin/customers/:id', verifyToken, (req, res) => {
    try {
        db.prepare('UPDATE customers SET status = "inactive" WHERE id = ?').run(req.params.id);
        res.json({ message: 'Customer deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== ORDERS ====================

app.get('/api/admin/orders', verifyToken, (req, res) => {
    try {
        const orders = db.prepare(`
            SELECT o.*, c.name as customer_name, c.phone as customer_phone,
                   p.name as plan_name, p.duration_days,
                   k.name as kitchen_name
            FROM orders o
            LEFT JOIN customers c ON o.customer_id = c.id
            LEFT JOIN subscription_plans p ON o.plan_id = p.id
            LEFT JOIN kitchens k ON o.kitchen_id = k.id
            ORDER BY o.created_at DESC
        `).all();
        res.json(orders || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/orders', verifyToken, (req, res) => {
    try {
        const { customer_id, plan_id, kitchen_id, start_date, paid_amount, notes } = req.body;
        if (!customer_id || !plan_id || !start_date) {
            return res.status(400).json({ error: 'Customer, plan and start date required' });
        }

        const plan = db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(plan_id);
        if (!plan) return res.status(404).json({ error: 'Plan not found' });

        const endDate = new Date(start_date);
        endDate.setDate(endDate.getDate() + plan.duration_days);
        const end_date = endDate.toISOString().split('T')[0];

        const result = db.prepare(`
            INSERT INTO orders (customer_id, plan_id, kitchen_id, start_date, end_date, total_amount, paid_amount, notes) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(customer_id, plan_id, kitchen_id || null, start_date, end_date, plan.price, paid_amount || 0, notes || '');

        // Auto-generate deliveries
        const deliveryDate = new Date(start_date);
        const meals = plan.meal_selection ? plan.meal_selection.split(',') : ['lunch'];
        for (let i = 0; i < plan.num_deliveries; i++) {
            for (const meal of meals) {
                db.prepare(`
                    INSERT INTO deliveries (order_id, customer_id, kitchen_id, delivery_date, meal_type, status)
                    VALUES (?, ?, ?, ?, ?, 'pending')
                `).run(result.lastInsertRowid, customer_id, kitchen_id || null, deliveryDate.toISOString().split('T')[0], meal.trim());
            }
            deliveryDate.setDate(deliveryDate.getDate() + 1);
        }

        res.status(201).json({ message: 'Order created', orderId: result.lastInsertRowid });
    } catch (err) {
        console.error('Order error:', err);
        res.status(400).json({ error: err.message });
    }
});

app.put('/api/admin/orders/:id/status', verifyToken, (req, res) => {
    try {
        const { order_status, payment_status, paid_amount } = req.body;
        db.prepare(`
            UPDATE orders SET order_status=COALESCE(?, order_status), 
            payment_status=COALESCE(?, payment_status),
            paid_amount=COALESCE(?, paid_amount) WHERE id=?
        `).run(order_status || null, payment_status || null, paid_amount || null, req.params.id);
        res.json({ message: 'Order updated' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// ==================== DELIVERIES ====================

app.get('/api/admin/deliveries', verifyToken, (req, res) => {
    try {
        const { date, status } = req.query;
        let query = `
            SELECT d.*, c.name as customer_name, c.address as customer_address, c.phone as customer_phone,
                   k.name as kitchen_name, o.id as order_ref
            FROM deliveries d
            LEFT JOIN customers c ON d.customer_id = c.id
            LEFT JOIN kitchens k ON d.kitchen_id = k.id
            LEFT JOIN orders o ON d.order_id = o.id
            WHERE 1=1
        `;
        const params = [];
        if (date) { query += ' AND d.delivery_date = ?'; params.push(date); }
        if (status) { query += ' AND d.status = ?'; params.push(status); }
        query += ' ORDER BY d.delivery_date DESC, d.id DESC';

        const deliveries = db.prepare(query).all(...params);
        res.json(deliveries || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/deliveries/:id/status', verifyToken, (req, res) => {
    try {
        const { status, delivery_agent, notes } = req.body;
        const delivered_at = status === 'delivered' ? new Date().toISOString() : null;
        db.prepare(`
            UPDATE deliveries SET status=?, delivery_agent=COALESCE(?, delivery_agent), 
            notes=COALESCE(?, notes), delivered_at=COALESCE(?, delivered_at) WHERE id=?
        `).run(status, delivery_agent || null, notes || null, delivered_at, req.params.id);
        res.json({ message: 'Delivery updated' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// ==================== HEALTH CHECK ====================

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// ==================== STATIC FILES (FIXED) ====================

// Serve public directory (where index.html lives)
app.use(express.static(path.join(__dirname, 'public')));

// Also serve root-level index.html if public/ doesn't have one
app.get('/', (req, res) => {
    const publicIndex = path.join(__dirname, 'public', 'index.html');
    const rootIndex = path.join(__dirname, 'index.html');
    
    if (fs.existsSync(publicIndex)) {
        res.sendFile(publicIndex);
    } else if (fs.existsSync(rootIndex)) {
        res.sendFile(rootIndex);
    } else {
        res.send('<h1>Salad Caffe API Running</h1><p>Place index.html in the public/ folder</p>');
    }
});

// Catch-all: serve SPA for non-API routes
app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    const publicIndex = path.join(__dirname, 'public', 'index.html');
    const rootIndex = path.join(__dirname, 'index.html');
    if (fs.existsSync(publicIndex)) return res.sendFile(publicIndex);
    if (fs.existsSync(rootIndex)) return res.sendFile(rootIndex);
    next();
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
