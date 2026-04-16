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
const JWT_SECRET = process.env.JWT_SECRET || 'your_secret_key';

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Initialize Database
const db = new Database('./salad_caffe.db');
db.pragma('journal_mode = WAL');

console.log('✓ Connected to database');
initializeDatabase();

// ==================== DATABASE INITIALIZATION ====================

function initializeDatabase() {
    try {
        // 1. USERS TABLE
        db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                phone TEXT,
                alternate_phone TEXT,
                whatsapp_number TEXT,
                home_address TEXT,
                home_location TEXT,
                office_address TEXT,
                office_location TEXT,
                height INTEGER,
                weight INTEGER,
                lifestyle_diseases TEXT,
                occupation TEXT,
                allergies TEXT,
                special_instructions TEXT,
                user_type TEXT NOT NULL,
                authority TEXT NOT NULL,
                territory_id INTEGER,
                kitchen_id INTEGER,
                status TEXT DEFAULT 'active',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 2. TERRITORIES TABLE
        db.exec(`
            CREATE TABLE IF NOT EXISTS territories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                manager_id INTEGER,
                description TEXT,
                status TEXT DEFAULT 'active',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 3. KITCHENS TABLE
        db.exec(`
            CREATE TABLE IF NOT EXISTS kitchens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                territory_id INTEGER NOT NULL,
                address TEXT,
                manager_id INTEGER,
                capacity INTEGER,
                operating_hours TEXT,
                status TEXT DEFAULT 'active',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(territory_id) REFERENCES territories(id)
            )
        `);

        // 4. MEAL CATEGORIES TABLE
        db.exec(`
            CREATE TABLE IF NOT EXISTS meal_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                status TEXT DEFAULT 'active',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 5. MEAL ITEMS TABLE
        db.exec(`
            CREATE TABLE IF NOT EXISTS meal_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                category_id INTEGER NOT NULL,
                veg_tag INTEGER DEFAULT 0,
                non_veg_tag INTEGER DEFAULT 0,
                description TEXT,
                calories INTEGER,
                ingredients TEXT,
                weight TEXT,
                mrp DECIMAL(10, 2),
                image_url TEXT,
                prep_time_minutes INTEGER,
                status TEXT DEFAULT 'active',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(category_id) REFERENCES meal_categories(id)
            )
        `);

        // 6. MENU SCHEDULE TABLE (Monthly)
        db.exec(`
            CREATE TABLE IF NOT EXISTS menu_schedules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                month INTEGER NOT NULL,
                year INTEGER NOT NULL,
                day_of_week INTEGER NOT NULL,
                meal_type TEXT NOT NULL,
                meal_item_id INTEGER NOT NULL,
                category TEXT NOT NULL,
                created_by INTEGER,
                status TEXT DEFAULT 'active',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(month, year, day_of_week, meal_type),
                FOREIGN KEY(meal_item_id) REFERENCES meal_items(id)
            )
        `);

        // 7. SUBSCRIPTION PLANS TABLE
        db.exec(`
            CREATE TABLE IF NOT EXISTS subscription_plans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                duration_days INTEGER NOT NULL,
                num_deliveries INTEGER NOT NULL,
                diet_type TEXT NOT NULL,
                price DECIMAL(10, 2) NOT NULL,
                meal_selection TEXT NOT NULL,
                menu_schedule TEXT,
                description TEXT,
                status TEXT DEFAULT 'active',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 8. SUBSCRIPTIONS TABLE
        db.exec(`
            CREATE TABLE IF NOT EXISTS subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL,
                plan_id INTEGER NOT NULL,
                start_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                end_date DATETIME,
                extension_end_date DATETIME,
                status TEXT DEFAULT 'active',
                remaining_deliveries INTEGER,
                paused_until DATETIME,
                cancellation_reason TEXT,
                delivery_address TEXT,
                google_location TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(customer_id) REFERENCES users(id),
                FOREIGN KEY(plan_id) REFERENCES subscription_plans(id)
            )
        `);

        // 9. DAILY ORDERS TABLE
        db.exec(`
            CREATE TABLE IF NOT EXISTS daily_orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subscription_id INTEGER NOT NULL,
                customer_id INTEGER NOT NULL,
                plan_id INTEGER NOT NULL,
                order_date DATE NOT NULL,
                day_of_week INTEGER,
                meal_type TEXT NOT NULL,
                meal_item_id INTEGER NOT NULL,
                meal_variant TEXT,
                status TEXT DEFAULT 'scheduled',
                cancelled_at DATETIME,
                cancellation_reason TEXT,
                cancelled_by TEXT,
                delivery_address TEXT,
                google_location TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(subscription_id) REFERENCES subscriptions(id),
                FOREIGN KEY(customer_id) REFERENCES users(id),
                FOREIGN KEY(plan_id) REFERENCES subscription_plans(id),
                FOREIGN KEY(meal_item_id) REFERENCES meal_items(id)
            )
        `);

        // 10. CANCELLATIONS TABLE
        db.exec(`
            CREATE TABLE IF NOT EXISTS cancellations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER NOT NULL,
                customer_id INTEGER NOT NULL,
                reason TEXT,
                cancelled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                cancelled_by TEXT,
                refund_status TEXT DEFAULT 'rolled_over',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(order_id) REFERENCES daily_orders(id),
                FOREIGN KEY(customer_id) REFERENCES users(id)
            )
        `);

        // 11. DELIVERIES TABLE
        db.exec(`
            CREATE TABLE IF NOT EXISTS deliveries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER NOT NULL,
                customer_id INTEGER NOT NULL,
                delivery_boy_id INTEGER,
                status TEXT DEFAULT 'pending',
                scheduled_time TEXT,
                picked_at DATETIME,
                delivered_at DATETIME,
                delivery_address TEXT,
                google_location TEXT,
                customer_phone TEXT,
                delivery_boy_phone TEXT,
                whatsapp_out_for_delivery INTEGER DEFAULT 0,
                whatsapp_delivered INTEGER DEFAULT 0,
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(order_id) REFERENCES daily_orders(id),
                FOREIGN KEY(customer_id) REFERENCES users(id),
                FOREIGN KEY(delivery_boy_id) REFERENCES users(id)
            )
        `);

        // 12. DELIVERY ASSIGNMENTS TABLE
        db.exec(`
            CREATE TABLE IF NOT EXISTS delivery_assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL,
                delivery_boy_id INTEGER NOT NULL,
                territory_id INTEGER,
                assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                unassigned_at DATETIME,
                is_active INTEGER DEFAULT 1,
                auto_suggested INTEGER DEFAULT 0,
                FOREIGN KEY(customer_id) REFERENCES users(id),
                FOREIGN KEY(delivery_boy_id) REFERENCES users(id),
                FOREIGN KEY(territory_id) REFERENCES territories(id)
            )
        `);

        // 13. CUSTOMER DIET PREFERENCES TABLE
        db.exec(`
            CREATE TABLE IF NOT EXISTS customer_diet_preferences (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL UNIQUE,
                diet_type TEXT NOT NULL,
                allergies TEXT,
                restrictions TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(customer_id) REFERENCES users(id)
            )
        `);

        // 14. STAFF ASSIGNMENTS TABLE
        db.exec(`
            CREATE TABLE IF NOT EXISTS staff_assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                staff_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                territory_id INTEGER,
                kitchen_id INTEGER,
                assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                unassigned_at DATETIME,
                status TEXT DEFAULT 'active',
                FOREIGN KEY(staff_id) REFERENCES users(id),
                FOREIGN KEY(territory_id) REFERENCES territories(id),
                FOREIGN KEY(kitchen_id) REFERENCES kitchens(id)
            )
        `);

        console.log('✓ Database tables initialized');
        insertSampleData();
    } catch (err) {
        console.error('Database init error:', err);
    }
}

// ==================== SAMPLE DATA ====================

function insertSampleData() {
    try {
        // Insert meal categories
        db.exec(`
            INSERT OR IGNORE INTO meal_categories (name, description) VALUES 
            ('Salads', 'Fresh and healthy salad bowls'),
            ('Wraps', 'Delicious wraps with various fillings'),
            ('Sandwiches', 'Nutritious sandwich options'),
            ('Multigrain Bowls', 'Wholesome multigrain bowls'),
            ('Pasta Bowls', 'Italian pasta preparations'),
            ('Rice Bowls', 'Rice based healthy bowls')
        `);

        // Insert territories
        db.exec(`
            INSERT OR IGNORE INTO territories (name, description) VALUES 
            ('Kochi', 'Kochi metropolitan area'),
            ('Trivandrum', 'Trivandrum metropolitan area')
        `);

        // Insert sample meal items
        db.exec(`
            INSERT OR IGNORE INTO meal_items (name, category_id, veg_tag, non_veg_tag, description, calories, ingredients, weight, mrp, prep_time_minutes) VALUES 
            ('Spinach Salad', 1, 1, 0, 'Fresh spinach with olive oil', 250, 'Spinach, olive oil, lemon', '300g', 249, 15),
            ('Grilled Chicken Salad', 1, 0, 1, 'Grilled chicken with mixed greens', 350, 'Chicken, mixed greens, olive oil', '350g', 299, 25),
            ('Vegetable Wrap', 2, 1, 0, 'Wrap with fresh vegetables', 280, 'Vegetables, tortilla, mayo', '250g', 249, 12),
            ('Chicken Wrap', 2, 0, 1, 'Wrap with grilled chicken', 380, 'Chicken, vegetables, tortilla', '300g', 299, 20),
            ('Paneer Sandwich', 3, 1, 0, 'Paneer with cheese', 320, 'Paneer, cheese, bread', '200g', 249, 10),
            ('Grilled Chicken Sandwich', 3, 0, 1, 'Grilled chicken sandwich', 380, 'Chicken, bread, mayo', '220g', 299, 15),
            ('Multigrain with Veggies', 4, 1, 0, 'Multigrain bowl with vegetables', 300, 'Multigrain, vegetables, olive oil', '350g', 249, 18),
            ('Multigrain with Chicken', 4, 0, 1, 'Multigrain bowl with chicken', 420, 'Multigrain, chicken, vegetables', '400g', 299, 25),
            ('Vegetable Pasta', 5, 1, 0, 'Pasta with vegetables', 350, 'Pasta, vegetables, olive oil', '350g', 249, 20),
            ('Pasta Carbonara', 5, 0, 1, 'Classic carbonara pasta', 450, 'Pasta, bacon, cream, egg', '400g', 299, 25)
        `);

        console.log('✓ Sample data inserted');
    } catch (err) {
        console.log('Sample data already exists or insertion error:', err.message);
    }
}

// ==================== AUTHENTICATION ====================

// Register User (Super Admin only)
app.post('/api/auth/register', (req, res) => {
    try {
        const { name, email, password, phone, authority, territory_id, kitchen_id } = req.body;

        if (!name || !email || !password || !authority) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const hashedPassword = bcrypt.hashSync(password, 10);

        const stmt = db.prepare(
            `INSERT INTO users (name, email, password, phone, authority, territory_id, kitchen_id, user_type) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );
        const result = stmt.run(name, email, hashedPassword, phone, authority, territory_id || null, kitchen_id || null, 'staff');

        const token = jwt.sign({ id: result.lastInsertRowid, email, authority }, JWT_SECRET, { expiresIn: '7d' });
        res.status(201).json({
            message: 'User registered successfully',
            token,
            user: { id: result.lastInsertRowid, name, email, authority }
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Login
app.post('/api/auth/login', (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
        const user = stmt.get(email);

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const validPassword = bcrypt.compareSync(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ id: user.id, email: user.email, authority: user.authority }, JWT_SECRET, { expiresIn: '7d' });
        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                authority: user.authority,
                phone: user.phone
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'Login error' });
    }
});

// Verify Token
function verifyToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];

    if (!token) {
        return res.status(403).json({ error: 'Token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        req.user = decoded;
        next();
    });
}

// ==================== MEAL CATEGORIES ENDPOINTS ====================

// Get all categories
app.get('/api/admin/categories', verifyToken, (req, res) => {
    try {
        const stmt = db.prepare('SELECT * FROM meal_categories WHERE status = "active"');
        const categories = stmt.all();
        res.json(categories);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create category
app.post('/api/admin/categories', verifyToken, (req, res) => {
    try {
        const { name, description } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Category name required' });
        }

        const stmt = db.prepare(
            'INSERT INTO meal_categories (name, description) VALUES (?, ?)'
        );
        const result = stmt.run(name, description);

        res.status(201).json({
            message: 'Category created',
            categoryId: result.lastInsertRowid
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// ==================== MEAL ITEMS ENDPOINTS ====================

// Get all meal items
app.get('/api/admin/meal-items', verifyToken, (req, res) => {
    try {
        const stmt = db.prepare(`
            SELECT m.*, c.name as category_name 
            FROM meal_items m 
            JOIN meal_categories c ON m.category_id = c.id 
            WHERE m.status = "active"
            ORDER BY c.name, m.name
        `);
        const items = stmt.all();
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create meal item
app.post('/api/admin/meal-items', verifyToken, (req, res) => {
    try {
        const { name, category_id, veg_tag, non_veg_tag, description, calories, ingredients, weight, mrp, prep_time_minutes } = req.body;

        if (!name || !category_id) {
            return res.status(400).json({ error: 'Name and category required' });
        }

        const stmt = db.prepare(`
            INSERT INTO meal_items 
            (name, category_id, veg_tag, non_veg_tag, description, calories, ingredients, weight, mrp, prep_time_minutes) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(name, category_id, veg_tag ? 1 : 0, non_veg_tag ? 1 : 0, description, calories, ingredients, weight, mrp, prep_time_minutes);

        res.status(201).json({
            message: 'Meal item created',
            mealItemId: result.lastInsertRowid
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Update meal item
app.put('/api/admin/meal-items/:id', verifyToken, (req, res) => {
    try {
        const { id } = req.params;
        const { name, category_id, veg_tag, non_veg_tag, description, calories, ingredients, weight, mrp, prep_time_minutes } = req.body;

        const stmt = db.prepare(`
            UPDATE meal_items 
            SET name = ?, category_id = ?, veg_tag = ?, non_veg_tag = ?, description = ?, 
                calories = ?, ingredients = ?, weight = ?, mrp = ?, prep_time_minutes = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        stmt.run(name, category_id, veg_tag ? 1 : 0, non_veg_tag ? 1 : 0, description, calories, ingredients, weight, mrp, prep_time_minutes, id);

        res.json({ message: 'Meal item updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== TERRITORIES ENDPOINTS ====================

// Get all territories
app.get('/api/admin/territories', verifyToken, (req, res) => {
    try {
        const stmt = db.prepare('SELECT * FROM territories WHERE status = "active"');
        const territories = stmt.all();
        res.json(territories);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create territory
app.post('/api/admin/territories', verifyToken, (req, res) => {
    try {
        const { name, description, manager_id } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Territory name required' });
        }

        const stmt = db.prepare(
            'INSERT INTO territories (name, description, manager_id) VALUES (?, ?, ?)'
        );
        const result = stmt.run(name, description, manager_id || null);

        res.status(201).json({
            message: 'Territory created',
            territoryId: result.lastInsertRowid
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// ==================== KITCHENS ENDPOINTS ====================

// Get all kitchens
app.get('/api/admin/kitchens', verifyToken, (req, res) => {
    try {
        const stmt = db.prepare(`
            SELECT k.*, t.name as territory_name 
            FROM kitchens k 
            LEFT JOIN territories t ON k.territory_id = t.id 
            WHERE k.status = "active"
        `);
        const kitchens = stmt.all();
        res.json(kitchens);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create kitchen
app.post('/api/admin/kitchens', verifyToken, (req, res) => {
    try {
        const { name, territory_id, address, manager_id, capacity } = req.body;

        if (!name || !territory_id) {
            return res.status(400).json({ error: 'Name and territory required' });
        }

        const stmt = db.prepare(
            'INSERT INTO kitchens (name, territory_id, address, manager_id, capacity) VALUES (?, ?, ?, ?, ?)'
        );
        const result = stmt.run(name, territory_id, address, manager_id || null, capacity);

        res.status(201).json({
            message: 'Kitchen created',
            kitchenId: result.lastInsertRowid
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// ==================== SUBSCRIPTION PLANS ENDPOINTS ====================

// Get all subscription plans
app.get('/api/admin/subscription-plans', verifyToken, (req, res) => {
    try {
        const stmt = db.prepare('SELECT * FROM subscription_plans WHERE status = "active"');
        const plans = stmt.all();
        
        // Parse menu_schedule JSON
        const plansWithMenu = plans.map(plan => ({
            ...plan,
            menu_schedule: plan.menu_schedule ? JSON.parse(plan.menu_schedule) : null
        }));
        
        res.json(plansWithMenu);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create subscription plan
app.post('/api/admin/subscription-plans', verifyToken, (req, res) => {
    try {
        const { name, duration_days, num_deliveries, diet_type, price, meal_selection, menu_schedule, description } = req.body;

        if (!name || !duration_days || !num_deliveries || !diet_type || !price || !meal_selection) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const stmt = db.prepare(`
            INSERT INTO subscription_plans 
            (name, duration_days, num_deliveries, diet_type, price, meal_selection, menu_schedule, description) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(
            name,
            duration_days,
            num_deliveries,
            diet_type,
            price,
            meal_selection,
            menu_schedule ? JSON.stringify(menu_schedule) : null,
            description
        );

        res.status(201).json({
            message: 'Subscription plan created',
            planId: result.lastInsertRowid
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Update subscription plan
app.put('/api/admin/subscription-plans/:id', verifyToken, (req, res) => {
    try {
        const { id } = req.params;
        const { name, duration_days, num_deliveries, diet_type, price, meal_selection, menu_schedule, description } = req.body;

        const stmt = db.prepare(`
            UPDATE subscription_plans 
            SET name = ?, duration_days = ?, num_deliveries = ?, diet_type = ?, price = ?, 
                meal_selection = ?, menu_schedule = ?, description = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        stmt.run(
            name,
            duration_days,
            num_deliveries,
            diet_type,
            price,
            meal_selection,
            menu_schedule ? JSON.stringify(menu_schedule) : null,
            description,
            id
        );

        res.json({ message: 'Subscription plan updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== MENU SCHEDULE ENDPOINTS ====================

// Get monthly menu schedule
app.get('/api/admin/menu-schedule/:month/:year', verifyToken, (req, res) => {
    try {
        const { month, year } = req.params;
        const stmt = db.prepare(`
            SELECT m.*, c.name as category_name, mi.name as item_name
            FROM menu_schedules m
            JOIN meal_categories c ON m.category = c.name
            JOIN meal_items mi ON m.meal_item_id = mi.id
            WHERE m.month = ? AND m.year = ? AND m.status = "active"
            ORDER BY m.day_of_week, m.meal_type
        `);
        const schedule = stmt.all(month, year);
        res.json(schedule);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create menu schedule entry
app.post('/api/admin/menu-schedule', verifyToken, (req, res) => {
    try {
        const { month, year, day_of_week, meal_type, meal_item_id, category } = req.body;

        if (!month || !year || !day_of_week || !meal_type || !meal_item_id || !category) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const stmt = db.prepare(`
            INSERT INTO menu_schedules 
            (month, year, day_of_week, meal_type, meal_item_id, category, created_by) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(month, year, day_of_week, meal_type, meal_item_id, category, req.user.id);

        res.status(201).json({
            message: 'Menu schedule entry created',
            scheduleId: result.lastInsertRowid
        });
    } catch (err) {
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

// ==================== SERVE STATIC FILES ====================

let indexHtml = '';
try {
    indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    console.log('✓ Loaded index.html from public folder');
} catch (err) {
    console.warn('⚠ Could not load index.html');
    indexHtml = '<h1>Salad Caffe API Server</h1><p>Frontend loading...</p>';
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

// ==================== ERROR HANDLING ====================

app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ 
        error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message 
    });
});

// Start Server
app.listen(PORT, () => {
    console.log(`✓ Server running on port ${PORT}`);
});

module.exports = app;
