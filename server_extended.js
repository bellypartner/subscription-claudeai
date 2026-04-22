const express = require('express');
const { Pool } = require('pg');
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

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const db = {
    query: (t, p) => pool.query(t, p),
    one:   async (t, p) => { const r = await pool.query(t, p); return r.rows[0] || null; },
    all:   async (t, p) => { const r = await pool.query(t, p); return r.rows; },
};

async function initDB() {
    // Core tables
    await db.query(`CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL, phone TEXT, authority TEXT DEFAULT 'customer',
        status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS meal_categories (
        id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT,
        status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS meal_items (
        id SERIAL PRIMARY KEY, name TEXT NOT NULL,
        category_id INTEGER NOT NULL REFERENCES meal_categories(id),
        veg_tag INTEGER DEFAULT 0, non_veg_tag INTEGER DEFAULT 0,
        eggetarian_tag INTEGER DEFAULT 0, vegan_tag INTEGER DEFAULT 0,
        description TEXT, ingredients TEXT, allergy_info TEXT,
        calories INTEGER, proteins DECIMAL(6,2), carbs DECIMAL(6,2),
        fiber DECIMAL(6,2), sugar DECIMAL(6,2), vitamins TEXT,
        mrp DECIMAL(10,2), image_base64 TEXT,
        status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS territories (
        id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT,
        status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS kitchens (
        id SERIAL PRIMARY KEY, name TEXT NOT NULL,
        territory_id INTEGER NOT NULL REFERENCES territories(id),
        address TEXT, capacity INTEGER, status TEXT DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`);

    // plan_menus: stores the 24-slot cycle definition
    // Each slot has: slot_number (1-24), day_type (veg/non_veg),
    //   primary_item_id (veg item on veg days, non-veg item on non-veg days)
    //   alternate_item_id (veg substitute on non-veg days, non-veg substitute on veg days)
    await db.query(`CREATE TABLE IF NOT EXISTS plan_menus (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        meal_type TEXT NOT NULL DEFAULT 'lunch',
        status TEXT DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS plan_menu_slots (
        id SERIAL PRIMARY KEY,
        plan_menu_id INTEGER NOT NULL REFERENCES plan_menus(id),
        slot_number INTEGER NOT NULL,
        weekday INTEGER NOT NULL DEFAULT 1,
        day_type TEXT NOT NULL CHECK (day_type IN ('veg','non_veg')),
        category_id INTEGER REFERENCES meal_categories(id),
        primary_item_id INTEGER REFERENCES meal_items(id),
        alternate_item_id INTEGER REFERENCES meal_items(id),
        UNIQUE(plan_menu_id, slot_number)
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS subscription_plans (
        id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE,
        duration_days INTEGER DEFAULT 28, num_deliveries INTEGER DEFAULT 24,
        diet_type TEXT, price DECIMAL(10,2), meal_types TEXT,
        delivery_days TEXT DEFAULT '1,2,3,4,5,6',
        plan_menu_id INTEGER REFERENCES plan_menus(id),
        status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id),
        name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT,
        address TEXT, alternate_address TEXT, territory_id INTEGER,
        allergies TEXT, health_notes TEXT,
        diet_preference TEXT DEFAULT 'non_veg',
        status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        plan_id INTEGER NOT NULL REFERENCES subscription_plans(id),
        kitchen_id INTEGER REFERENCES kitchens(id),
        start_date DATE NOT NULL, end_date DATE NOT NULL,
        menu_start_slot INTEGER DEFAULT 1,
        total_amount DECIMAL(10,2), paid_amount DECIMAL(10,2) DEFAULT 0,
        payment_status TEXT DEFAULT 'pending',
        order_status TEXT DEFAULT 'active',
        pause_start DATE, pause_end DATE, extended_days INTEGER DEFAULT 0,
        notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS deliveries (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES orders(id),
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        kitchen_id INTEGER REFERENCES kitchens(id),
        delivery_date DATE NOT NULL,
        meal_type TEXT NOT NULL,
        slot_number INTEGER,
        meal_item_id INTEGER REFERENCES meal_items(id),
        is_veg_customer INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending',
        delivery_agent TEXT, delivered_at TIMESTAMPTZ,
        skipped_reason TEXT, is_sunday_skip INTEGER DEFAULT 0,
        notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS meal_skip_log (
        id SERIAL PRIMARY KEY,
        delivery_id INTEGER NOT NULL REFERENCES deliveries(id),
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        reason TEXT, skipped_at TIMESTAMPTZ DEFAULT NOW()
    )`);

    // Safe migrations for existing DBs
    // --- New columns for slot/weekday/category/delivery_days system ---
    const alters = [
        `ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS eggetarian_tag INTEGER DEFAULT 0`,
        `ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS vegan_tag INTEGER DEFAULT 0`,
        `ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS ingredients TEXT`,
        `ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS allergy_info TEXT`,
        `ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS proteins DECIMAL(6,2)`,
        `ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS carbs DECIMAL(6,2)`,
        `ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS fiber DECIMAL(6,2)`,
        `ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS sugar DECIMAL(6,2)`,
        `ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS vitamins TEXT`,
        `ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS image_base64 TEXT`,
        `ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS plan_menu_id INTEGER`,
        `ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS meal_types TEXT`,
        `ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS slot_number INTEGER`,
        `ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS is_veg_customer INTEGER DEFAULT 0`,
        `ALTER TABLE customers ADD COLUMN IF NOT EXISTS diet_preference TEXT DEFAULT 'non_veg'`,
        `ALTER TABLE plan_menu_slots ADD COLUMN IF NOT EXISTS category_id INTEGER`,
        `ALTER TABLE plan_menu_slots ADD COLUMN IF NOT EXISTS weekday INTEGER DEFAULT 1`,
        `ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS delivery_days TEXT DEFAULT '1,2,3,4,5,6'`,
        `ALTER TABLE orders ADD COLUMN IF NOT EXISTS menu_start_slot INTEGER DEFAULT 1`,
        `ALTER TABLE plan_menus ADD COLUMN IF NOT EXISTS meal_type TEXT DEFAULT 'lunch'`,
    ];
    for (const sql of alters) { try { await db.query(sql); } catch(e) {} }

    // Seed super admin
    const sa = await db.one(`SELECT id FROM users WHERE email=$1`, ['super@test.com']);
    if (!sa) {
        const h = bcrypt.hashSync('password123', 10);
        await db.query(`INSERT INTO users (name,email,password,authority) VALUES ($1,$2,$3,'super_admin')`,
            ['Super Admin', 'super@test.com', h]);
    }
    // Seed kitchen user
    const ku = await db.one(`SELECT id FROM users WHERE email=$1`, ['kitchen@test.com']);
    if (!ku) {
        const h = bcrypt.hashSync('kitchen123', 10);
        await db.query(`INSERT INTO users (name,email,password,authority) VALUES ($1,$2,$3,'kitchen_manager')`,
            ['Kitchen Manager', 'kitchen@test.com', h]);
    }
    // Seed demo customer
    const dc = await db.one(`SELECT id FROM users WHERE email=$1`, ['customer@test.com']);
    if (!dc) {
        const h = bcrypt.hashSync('customer123', 10);
        const u = await db.one(`INSERT INTO users (name,email,password,phone,authority) VALUES ($1,$2,$3,$4,'customer') RETURNING id`,
            ['Demo Customer', 'customer@test.com', h, '9876543210']);
        await db.query(`INSERT INTO customers (user_id,name,email,phone,address,diet_preference) VALUES ($1,$2,$3,$4,$5,'non_veg')`,
            [u.id, 'Demo Customer', 'customer@test.com', '9876543210', '123 Demo Street, Kochi']);
    }
    console.log('✅ Database ready');
}

// ==================== HELPERS ====================

// Generate Mon-Sat dates (skip Sundays), returns array of YYYY-MM-DD
function genDates(startStr, count) {
    const dates = [];
    const d = new Date(startStr + 'T12:00:00Z');
    while (dates.length < count) {
        if (d.getUTCDay() !== 0) dates.push(d.toISOString().split('T')[0]);
        d.setUTCDate(d.getUTCDate() + 1);
    }
    return dates;
}

function nextWorkDay(ds) {
    const d = new Date(ds + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().split('T')[0];
}

function toDS(v) {
    return v instanceof Date ? v.toISOString().split('T')[0] : String(v).split('T')[0];
}

// Slot 1-24: odd = veg day, even = non_veg day
function slotDayType(slotNumber) {
    return slotNumber % 2 === 1 ? 'veg' : 'non_veg';
}

// Given customer diet and slot day type, decide which item to assign
// pure_veg customer: veg day → primary, non_veg day → alternate (veg substitute)
// non_veg customer:  non_veg day → primary, veg day → alternate (non-veg substitute)
function pickItemForCustomer(slot, customerDiet) {
    const isVegCustomer = customerDiet === 'pure_veg' || customerDiet === 'vegan' || customerDiet === 'eggetarian';
    if (isVegCustomer) {
        return slot.day_type === 'veg' ? slot.primary_item_id : slot.alternate_item_id;
    } else {
        // non_veg customer
        return slot.day_type === 'non_veg' ? slot.primary_item_id : slot.alternate_item_id;
    }
}

function isVegCustomer(diet) {
    return ['pure_veg', 'vegan', 'eggetarian'].includes(diet);
}

// ==================== MIDDLEWARE ====================

function verifyToken(req, res, next) {
    try {
        const t = req.headers['authorization']?.split(' ')[1];
        if (!t) return res.status(403).json({ error: 'Token required' });
        req.user = jwt.verify(t, JWT_SECRET);
        next();
    } catch(e) { res.status(401).json({ error: 'Invalid token' }); }
}

function reqCust(req, res, next) {
    if (!['customer','super_admin','admin'].includes(req.user.authority))
        return res.status(403).json({ error: 'Access denied' });
    next();
}

function reqKitchen(req, res, next) {
    if (!['kitchen_manager','kitchen_staff','super_admin','admin'].includes(req.user.authority))
        return res.status(403).json({ error: 'Access denied' });
    next();
}

// ==================== AUTH ====================

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
        const user = await db.one(`SELECT * FROM users WHERE email=$1`, [email]);
        if (!user || !bcrypt.compareSync(password, user.password))
            return res.status(401).json({ error: 'Invalid credentials' });
        const token = jwt.sign(
            { id: user.id, email: user.email, authority: user.authority, name: user.name },
            JWT_SECRET, { expiresIn: '7d' }
        );
        let customer = null;
        if (user.authority === 'customer')
            customer = await db.one(`SELECT * FROM customers WHERE user_id=$1`, [user.id]);

        // Kitchen staff get their kitchen info
        let kitchenInfo = null;
        if (['kitchen_manager','kitchen_staff'].includes(user.authority)) {
            // Kitchen is linked by user — for now, return all kitchens if super
            kitchenInfo = await db.one(`SELECT k.* FROM kitchens k WHERE k.status='active' LIMIT 1`);
        }

        const redirectMap = {
            customer: '/customer',
            kitchen_manager: '/kitchen',
            kitchen_staff: '/kitchen',
        };

        res.json({
            message: 'Login successful', token,
            user: { id: user.id, name: user.name, email: user.email, authority: user.authority, phone: user.phone },
            customer, kitchen: kitchenInfo,
            redirectTo: redirectMap[user.authority] || '/'
        });
    } catch(e) { console.error(e); res.status(500).json({ error: 'Login failed' }); }
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password, phone, address, diet_preference } = req.body;
        if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });
        const h = bcrypt.hashSync(password, 10);
        const u = await db.one(`INSERT INTO users (name,email,password,phone,authority) VALUES ($1,$2,$3,$4,'customer') RETURNING id`,
            [name, email, h, phone || '']);
        await db.query(`INSERT INTO customers (user_id,name,email,phone,address,diet_preference) VALUES ($1,$2,$3,$4,$5,$6)`,
            [u.id, name, email, phone || '', address || '', diet_preference || 'non_veg']);
        const token = jwt.sign({ id: u.id, email, authority: 'customer', name }, JWT_SECRET, { expiresIn: '7d' });
        res.status(201).json({ message: 'Registered', token, redirectTo: '/customer' });
    } catch(e) {
        if (e.code === '23505') return res.status(400).json({ error: 'Email already registered' });
        res.status(500).json({ error: e.message });
    }
});

// ==================== CUSTOMER APIs ====================

app.get('/api/customer/profile', verifyToken, reqCust, async (req, res) => {
    try {
        const c = await db.one(`SELECT c.*,t.name as territory_name FROM customers c LEFT JOIN territories t ON c.territory_id=t.id WHERE c.user_id=$1`, [req.user.id]);
        if (!c) return res.status(404).json({ error: 'Not found' });
        res.json(c);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/customer/profile', verifyToken, reqCust, async (req, res) => {
    try {
        const { name, phone, address, alternate_address, allergies, health_notes, diet_preference } = req.body;
        await db.query(`UPDATE customers SET name=$1,phone=$2,address=$3,alternate_address=$4,allergies=$5,health_notes=$6,diet_preference=$7 WHERE user_id=$8`,
            [name, phone, address, alternate_address, allergies, health_notes, diet_preference, req.user.id]);
        await db.query(`UPDATE users SET name=$1,phone=$2 WHERE id=$3`, [name, phone, req.user.id]);
        res.json({ message: 'Updated' });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/customer/subscriptions', verifyToken, reqCust, async (req, res) => {
    try {
        const c = await db.one(`SELECT * FROM customers WHERE user_id=$1`, [req.user.id]);
        if (!c) return res.status(404).json({ error: 'Not found' });
        res.json(await db.all(`
            SELECT o.*,
                p.name as plan_name, p.diet_type, p.meal_types, p.duration_days, p.num_deliveries,
                k.name as kitchen_name,
                (SELECT COUNT(*)::int FROM deliveries WHERE order_id=o.id AND status='delivered') as delivered_count,
                (SELECT COUNT(*)::int FROM deliveries WHERE order_id=o.id AND status='pending') as pending_count,
                (SELECT COUNT(*)::int FROM deliveries WHERE order_id=o.id AND status='skipped' AND is_sunday_skip=0) as skipped_count
            FROM orders o
            LEFT JOIN subscription_plans p ON o.plan_id=p.id
            LEFT JOIN kitchens k ON o.kitchen_id=k.id
            WHERE o.customer_id=$1 ORDER BY o.created_at DESC
        `, [c.id]));
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/customer/calendar', verifyToken, reqCust, async (req, res) => {
    try {
        const c = await db.one(`SELECT * FROM customers WHERE user_id=$1`, [req.user.id]);
        const { month } = req.query;
        if (!month) return res.status(400).json({ error: 'month required (YYYY-MM)' });
        res.json(await db.all(`
            SELECT d.*, mi.name as meal_item_name, mi.calories, mi.veg_tag, mi.non_veg_tag,
                mc.name as category_name, p.name as plan_name, p.diet_type, k.name as kitchen_name
            FROM deliveries d
            LEFT JOIN meal_items mi ON d.meal_item_id=mi.id
            LEFT JOIN meal_categories mc ON mi.category_id=mc.id
            LEFT JOIN orders o ON d.order_id=o.id
            LEFT JOIN subscription_plans p ON o.plan_id=p.id
            LEFT JOIN kitchens k ON d.kitchen_id=k.id
            WHERE d.customer_id=$1 AND d.is_sunday_skip=0
              AND d.delivery_date>=($2||'-01')::date AND d.delivery_date<=($2||'-31')::date
            ORDER BY d.delivery_date ASC,
                CASE d.meal_type WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'dinner' THEN 3 ELSE 4 END
        `, [c.id, month]));
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/customer/upcoming-meals', verifyToken, reqCust, async (req, res) => {
    try {
        const c = await db.one(`SELECT * FROM customers WHERE user_id=$1`, [req.user.id]);
        // Only today and tomorrow as requested
        res.json(await db.all(`
            SELECT d.*, mi.name as meal_item_name, mi.calories, mi.veg_tag, mi.non_veg_tag,
                mc.name as category_name, p.name as plan_name, k.name as kitchen_name
            FROM deliveries d
            LEFT JOIN meal_items mi ON d.meal_item_id=mi.id
            LEFT JOIN meal_categories mc ON mi.category_id=mc.id
            LEFT JOIN orders o ON d.order_id=o.id
            LEFT JOIN subscription_plans p ON o.plan_id=p.id
            LEFT JOIN kitchens k ON d.kitchen_id=k.id
            WHERE d.customer_id=$1 AND d.is_sunday_skip=0
              AND d.delivery_date >= CURRENT_DATE
              AND d.delivery_date <= CURRENT_DATE + INTERVAL '1 day'
            ORDER BY d.delivery_date ASC,
                CASE d.meal_type WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'dinner' THEN 3 ELSE 4 END
        `, [c.id]));
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/customer/delivery-history', verifyToken, reqCust, async (req, res) => {
    try {
        const c = await db.one(`SELECT * FROM customers WHERE user_id=$1`, [req.user.id]);
        res.json(await db.all(`
            SELECT d.*, mi.name as meal_item_name, mc.name as category_name, p.name as plan_name
            FROM deliveries d
            LEFT JOIN meal_items mi ON d.meal_item_id=mi.id
            LEFT JOIN meal_categories mc ON mi.category_id=mc.id
            LEFT JOIN orders o ON d.order_id=o.id
            LEFT JOIN subscription_plans p ON o.plan_id=p.id
            WHERE d.customer_id=$1 AND d.delivery_date<CURRENT_DATE AND d.is_sunday_skip=0
            ORDER BY d.delivery_date DESC LIMIT 60
        `, [c.id]));
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/customer/skip-meal/:id', verifyToken, reqCust, async (req, res) => {
    try {
        const c = await db.one(`SELECT * FROM customers WHERE user_id=$1`, [req.user.id]);
        const d = await db.one(`SELECT * FROM deliveries WHERE id=$1 AND customer_id=$2`, [req.params.id, c.id]);
        if (!d) return res.status(404).json({ error: 'Delivery not found' });
        if (d.status !== 'pending') return res.status(400).json({ error: 'Cannot skip — already ' + d.status });
        const dl = new Date(toDS(d.delivery_date) + 'T22:00:00');
        dl.setDate(dl.getDate() - 1);
        if (new Date() > dl) return res.status(400).json({ error: 'Skip deadline passed (10 PM previous night)' });
        const { reason } = req.body;
        await db.query(`UPDATE deliveries SET status='skipped',skipped_reason=$1 WHERE id=$2`,
            [reason || 'Customer request', d.id]);
        await db.query(`INSERT INTO meal_skip_log (delivery_id,customer_id,reason) VALUES ($1,$2,$3)`,
            [d.id, c.id, reason || 'Customer request']);
        const order = await db.one(`SELECT * FROM orders WHERE id=$1`, [d.order_id]);
        if (order && order.extended_days < 45) {
            const ne = nextWorkDay(toDS(order.end_date));
            await db.query(`UPDATE orders SET end_date=$1,extended_days=extended_days+1 WHERE id=$2`, [ne, order.id]);
        }
        res.json({ message: `Meal skipped. Subscription extended by 1 working day. No refund.` });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/customer/pause-subscription/:id', verifyToken, reqCust, async (req, res) => {
    try {
        const c = await db.one(`SELECT * FROM customers WHERE user_id=$1`, [req.user.id]);
        const order = await db.one(`SELECT * FROM orders WHERE id=$1 AND customer_id=$2`, [req.params.id, c.id]);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        if (order.order_status !== 'active') return res.status(400).json({ error: 'Order not active' });
        const { pause_start, pause_end } = req.body;
        if (!pause_start || !pause_end) return res.status(400).json({ error: 'Dates required' });
        const days = Math.ceil((new Date(pause_end) - new Date(pause_start)) / 86400000);
        if (days < 1 || days > 30) return res.status(400).json({ error: 'Pause must be 1-30 days' });
        let ext = 0;
        const cur = new Date(pause_start + 'T12:00:00Z');
        const ed = new Date(pause_end + 'T12:00:00Z');
        while (cur <= ed) { if (cur.getUTCDay() !== 0) ext++; cur.setUTCDate(cur.getUTCDate() + 1); }
        await db.query(`UPDATE deliveries SET status='skipped',skipped_reason='Subscription paused' WHERE order_id=$1 AND delivery_date>=$2 AND delivery_date<=$3 AND status='pending' AND is_sunday_skip=0`,
            [order.id, pause_start, pause_end]);
        let ne = new Date(toDS(order.end_date) + 'T12:00:00Z');
        let added = 0;
        while (added < ext) { ne.setUTCDate(ne.getUTCDate() + 1); if (ne.getUTCDay() !== 0) added++; }
        await db.query(`UPDATE orders SET order_status='paused',pause_start=$1,pause_end=$2,end_date=$3 WHERE id=$4`,
            [pause_start, pause_end, ne.toISOString().split('T')[0], order.id]);
        res.json({ message: `Paused. End date extended. No refund for paused days.` });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/customer/cancel-subscription/:id', verifyToken, reqCust, async (req, res) => {
    try {
        const c = await db.one(`SELECT * FROM customers WHERE user_id=$1`, [req.user.id]);
        const order = await db.one(`SELECT * FROM orders WHERE id=$1 AND customer_id=$2`, [req.params.id, c.id]);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        if (['cancelled','completed'].includes(order.order_status))
            return res.status(400).json({ error: 'Already ' + order.order_status });
        await db.query(`UPDATE orders SET order_status='cancelled' WHERE id=$1`, [order.id]);
        await db.query(`UPDATE deliveries SET status='skipped',skipped_reason='Cancelled by customer' WHERE order_id=$1 AND status='pending'`, [order.id]);
        res.json({ message: 'Cancelled. No refund as per policy.' });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/customer/plans', async (req, res) => {
    try { res.json(await db.all(`SELECT * FROM subscription_plans WHERE status='active' ORDER BY price ASC`)); }
    catch(e) { res.status(500).json({ error: e.message }); }
});

// ==================== KITCHEN DASHBOARD APIs ====================

// Kitchen daily summary — the main report
// Returns: per meal_type → items to prepare with counts, split by veg/non-veg
// Then: skipped breakdown by veg/non-veg
// Then: net to prepare
app.get('/api/kitchen/daily-summary', verifyToken, reqKitchen, async (req, res) => {
    try {
        const { date, kitchen_id } = req.query;
        const targetDate = date || new Date().toISOString().split('T')[0];

        // Params
        const params = [targetDate];
        let kitchenFilter = '';
        if (kitchen_id) {
            params.push(parseInt(kitchen_id));
            kitchenFilter = `AND d.kitchen_id=$${params.length}`;
        }

        // All deliveries for this date, excluding Sundays and sunday_skip rows
        const allDeliveries = await db.all(`
            SELECT
                d.id, d.meal_type, d.status, d.is_veg_customer,
                d.meal_item_id, mi.name as meal_item_name,
                mi.veg_tag, mi.non_veg_tag, mi.eggetarian_tag, mi.vegan_tag,
                mi.calories, mi.image_base64,
                c.name as customer_name, c.phone as customer_phone,
                c.address as customer_address, c.diet_preference
            FROM deliveries d
            LEFT JOIN meal_items mi ON d.meal_item_id=mi.id
            LEFT JOIN customers c ON d.customer_id=c.id
            WHERE d.delivery_date=$1 AND d.is_sunday_skip=0
            ${kitchenFilter}
            ORDER BY d.meal_type, mi.name, c.name
        `, params);

        // Group by meal_type
        const mealTypes = [...new Set(allDeliveries.map(d => d.meal_type))];
        const summary = {};

        for (const mt of mealTypes) {
            const rows = allDeliveries.filter(d => d.meal_type === mt);
            const pending = rows.filter(d => d.status === 'pending');
            const skipped = rows.filter(d => d.status === 'skipped');
            const delivered = rows.filter(d => d.status === 'delivered');

            // Group pending by meal item
            const itemGroups = {};
            for (const r of pending) {
                const key = r.meal_item_id || 'unassigned';
                if (!itemGroups[key]) {
                    itemGroups[key] = {
                        meal_item_id: r.meal_item_id,
                        meal_item_name: r.meal_item_name || 'Not assigned',
                        calories: r.calories,
                        image_base64: r.image_base64,
                        veg_tag: r.veg_tag,
                        non_veg_tag: r.non_veg_tag,
                        total: 0, veg_count: 0, non_veg_count: 0
                    };
                }
                itemGroups[key].total++;
                if (r.is_veg_customer) itemGroups[key].veg_count++;
                else itemGroups[key].non_veg_count++;
            }

            // Skipped breakdown
            const skippedVeg = skipped.filter(d => d.is_veg_customer).length;
            const skippedNonVeg = skipped.filter(d => !d.is_veg_customer).length;

            // Delivered breakdown
            const deliveredVeg = delivered.filter(d => d.is_veg_customer).length;
            const deliveredNonVeg = delivered.filter(d => !d.is_veg_customer).length;

            summary[mt] = {
                meal_type: mt,
                total_customers: rows.length,
                items_to_prepare: Object.values(itemGroups),
                pending_total: pending.length,
                pending_veg: pending.filter(d => d.is_veg_customer).length,
                pending_non_veg: pending.filter(d => !d.is_veg_customer).length,
                skipped_total: skipped.length,
                skipped_veg: skippedVeg,
                skipped_non_veg: skippedNonVeg,
                delivered_total: delivered.length,
                delivered_veg: deliveredVeg,
                delivered_non_veg: deliveredNonVeg,
                net_to_prepare: pending.length, // pending = not yet delivered or skipped
                net_veg: pending.filter(d => d.is_veg_customer).length,
                net_non_veg: pending.filter(d => !d.is_veg_customer).length,
                customer_list: rows.map(r => ({
                    name: r.customer_name,
                    phone: r.customer_phone,
                    address: r.customer_address,
                    diet: r.diet_preference,
                    item: r.meal_item_name || 'Not assigned',
                    status: r.status,
                    is_veg: !!r.is_veg_customer
                }))
            };
        }

        res.json({ date: targetDate, summary, kitchen_id: kitchen_id || 'all' });
    } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// Kitchen list of kitchens for the login dropdown
app.get('/api/kitchen/list', verifyToken, async (req, res) => {
    try { res.json(await db.all(`SELECT id,name,address FROM kitchens WHERE status='active' ORDER BY name`)); }
    catch(e) { res.status(500).json({ error: e.message }); }
});

// Mark delivery as delivered (kitchen staff action)
app.put('/api/kitchen/delivery/:id/deliver', verifyToken, reqKitchen, async (req, res) => {
    try {
        const { delivery_agent, notes } = req.body;
        await db.query(`UPDATE deliveries SET status='delivered',delivery_agent=$1,notes=$2,delivered_at=NOW() WHERE id=$3`,
            [delivery_agent || null, notes || null, req.params.id]);
        res.json({ message: 'Marked as delivered' });
    } catch(e) { res.status(400).json({ error: e.message }); }
});

// ==================== ADMIN STATS ====================

app.get('/api/admin/stats', verifyToken, async (req, res) => {
    try {
        const [tc,to,ao,tr,pd,td,tm,tp,ro] = await Promise.all([
            db.one(`SELECT COUNT(*)::int as c FROM customers WHERE status='active'`),
            db.one(`SELECT COUNT(*)::int as c FROM orders`),
            db.one(`SELECT COUNT(*)::int as c FROM orders WHERE order_status='active'`),
            db.one(`SELECT COALESCE(SUM(paid_amount),0) as t FROM orders`),
            db.one(`SELECT COUNT(*)::int as c FROM deliveries WHERE status='pending' AND delivery_date=CURRENT_DATE AND is_sunday_skip=0`),
            db.one(`SELECT COUNT(*)::int as c FROM deliveries WHERE delivery_date=CURRENT_DATE AND is_sunday_skip=0`),
            db.one(`SELECT COUNT(*)::int as c FROM meal_items WHERE status='active'`),
            db.one(`SELECT COUNT(*)::int as c FROM subscription_plans WHERE status='active'`),
            db.all(`SELECT o.*,c.name as customer_name,p.name as plan_name FROM orders o LEFT JOIN customers c ON o.customer_id=c.id LEFT JOIN subscription_plans p ON o.plan_id=p.id ORDER BY o.created_at DESC LIMIT 5`)
        ]);
        res.json({ totalCustomers:tc.c, totalOrders:to.c, activeOrders:ao.c, totalRevenue:tr.t, pendingDeliveries:pd.c, todayDeliveries:td.c, totalMeals:tm.c, totalPlans:tp.c, recentOrders:ro });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ==================== ADMIN CATEGORIES ====================
app.get('/api/admin/categories', verifyToken, async (req, res) => {
    try { res.json(await db.all(`SELECT * FROM meal_categories WHERE status='active' ORDER BY name`)); }
    catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/categories', verifyToken, async (req, res) => {
    try {
        const { name, description } = req.body;
        if (!name) return res.status(400).json({ error: 'Name required' });
        const r = await db.one(`INSERT INTO meal_categories (name,description) VALUES ($1,$2) RETURNING id`, [name, description || '']);
        res.status(201).json({ message: 'Created', categoryId: r.id });
    } catch(e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/admin/categories/:id', verifyToken, async (req, res) => {
    try { await db.query(`UPDATE meal_categories SET status='inactive' WHERE id=$1`, [req.params.id]); res.json({ message: 'Deleted' }); }
    catch(e) { res.status(500).json({ error: e.message }); }
});

// ==================== ADMIN MEAL ITEMS ====================
app.get('/api/admin/meal-items', verifyToken, async (req, res) => {
    try { res.json(await db.all(`SELECT m.*,c.name as category_name FROM meal_items m LEFT JOIN meal_categories c ON m.category_id=c.id WHERE m.status='active' ORDER BY c.name,m.name`)); }
    catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/meal-items', verifyToken, async (req, res) => {
    try {
        const { name,category_id,veg_tag,non_veg_tag,eggetarian_tag,vegan_tag,description,ingredients,allergy_info,calories,proteins,carbs,fiber,sugar,vitamins,mrp,image_base64 } = req.body;
        if (!name || !category_id) return res.status(400).json({ error: 'Name and category required' });
        const r = await db.one(`INSERT INTO meal_items (name,category_id,veg_tag,non_veg_tag,eggetarian_tag,vegan_tag,description,ingredients,allergy_info,calories,proteins,carbs,fiber,sugar,vitamins,mrp,image_base64) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
            [name,category_id,veg_tag?1:0,non_veg_tag?1:0,eggetarian_tag?1:0,vegan_tag?1:0,description||'',ingredients||'',allergy_info||'',calories||0,proteins||null,carbs||null,fiber||null,sugar||null,vitamins||'',mrp||0,image_base64||null]);
        res.status(201).json({ message: 'Created', mealItemId: r.id });
    } catch(e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/admin/meal-items/:id', verifyToken, async (req, res) => {
    try { await db.query(`UPDATE meal_items SET status='inactive' WHERE id=$1`, [req.params.id]); res.json({ message: 'Deleted' }); }
    catch(e) { res.status(500).json({ error: e.message }); }
});

// ==================== ADMIN TERRITORIES ====================
app.get('/api/admin/territories', verifyToken, async (req, res) => {
    try { res.json(await db.all(`SELECT * FROM territories WHERE status='active' ORDER BY name`)); }
    catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/territories', verifyToken, async (req, res) => {
    try {
        const { name, description } = req.body;
        if (!name) return res.status(400).json({ error: 'Name required' });
        const r = await db.one(`INSERT INTO territories (name,description) VALUES ($1,$2) RETURNING id`, [name, description || '']);
        res.status(201).json({ message: 'Created', territoryId: r.id });
    } catch(e) { res.status(400).json({ error: e.message }); }
});

// ==================== ADMIN KITCHENS ====================
app.get('/api/admin/kitchens', verifyToken, async (req, res) => {
    try { res.json(await db.all(`SELECT k.*,t.name as territory_name FROM kitchens k LEFT JOIN territories t ON k.territory_id=t.id WHERE k.status='active' ORDER BY k.name`)); }
    catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/kitchens', verifyToken, async (req, res) => {
    try {
        const { name, territory_id, address, capacity } = req.body;
        if (!name || !territory_id) return res.status(400).json({ error: 'Name and territory required' });
        const r = await db.one(`INSERT INTO kitchens (name,territory_id,address,capacity) VALUES ($1,$2,$3,$4) RETURNING id`, [name, territory_id, address || '', capacity || 100]);
        res.status(201).json({ message: 'Created', kitchenId: r.id });
    } catch(e) { res.status(400).json({ error: e.message }); }
});

// ==================== PLAN MENUS (28-day cycle) ====================

// Get all plan menus with their 24 slots
app.get('/api/admin/plan-menus', verifyToken, async (req, res) => {
    try {
        const menus = await db.all(`SELECT * FROM plan_menus WHERE status='active' ORDER BY created_at DESC`);
        // Attach slot counts
        for (const m of menus) {
            const slots = await db.all(`
                SELECT pms.*,
                    mc.name as category_name,
                    pi.name as primary_item_name, pi.veg_tag as primary_veg, pi.non_veg_tag as primary_non_veg, pi.image_base64 as primary_image, pi.calories as primary_calories,
                    ai.name as alternate_item_name, ai.veg_tag as alt_veg, ai.non_veg_tag as alt_non_veg, ai.calories as alt_calories
                FROM plan_menu_slots pms
                LEFT JOIN meal_categories mc ON pms.category_id=mc.id
                LEFT JOIN meal_items pi ON pms.primary_item_id=pi.id
                LEFT JOIN meal_items ai ON pms.alternate_item_id=ai.id
                WHERE pms.plan_menu_id=$1 ORDER BY pms.slot_number
            `, [m.id]);
            m.slots = slots;
            m.slots_filled = slots.filter(s => s.primary_item_id).length;
        }
        res.json(menus);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Create a new plan menu (just the header — slots added separately)
app.post('/api/admin/plan-menus', verifyToken, async (req, res) => {
    try {
        const { name, meal_type } = req.body;
        if (!name) return res.status(400).json({ error: 'Name required' });
        const r = await db.one(`INSERT INTO plan_menus (name,meal_type) VALUES ($1,$2) RETURNING id`,
            [name, meal_type || 'lunch']);
        // Pre-create 24 empty slots with weekday
        for (let i = 1; i <= 24; i++) {
            const dayType = i % 2 === 1 ? 'veg' : 'non_veg';
            const weekday = ((i - 1) % 6) + 1;
            await db.query(`INSERT INTO plan_menu_slots (plan_menu_id,slot_number,weekday,day_type) VALUES ($1,$2,$3,$4)`,
                [r.id, i, weekday, dayType]);
        }
        res.status(201).json({ message: 'Plan menu created with 24 slots', menuId: r.id });
    } catch(e) { res.status(400).json({ error: e.message }); }
});

// Update a single slot (assign primary + alternate items)
app.put('/api/admin/plan-menus/:menuId/slots/:slotNum', verifyToken, async (req, res) => {
    try {
        const { primary_item_id, alternate_item_id } = req.body;
        const { category_id } = req.body;
        await db.query(`UPDATE plan_menu_slots SET primary_item_id=$1,alternate_item_id=$2,category_id=COALESCE($3,category_id) WHERE plan_menu_id=$4 AND slot_number=$5`,
            [primary_item_id || null, alternate_item_id || null, category_id || null, req.params.menuId, req.params.slotNum]);
        res.json({ message: 'Slot updated' });
    } catch(e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/admin/plan-menus/:id', verifyToken, async (req, res) => {
    try {
        await db.query(`DELETE FROM plan_menu_slots WHERE plan_menu_id=$1`, [req.params.id]);
        await db.query(`UPDATE plan_menus SET status='inactive' WHERE id=$1`, [req.params.id]);
        res.json({ message: 'Deleted' });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ==================== ADMIN PLANS ====================
app.get('/api/admin/subscription-plans', verifyToken, async (req, res) => {
    try {
        res.json(await db.all(`
            SELECT sp.*, pm.name as plan_menu_name, pm.meal_type as plan_menu_meal_type,
                (SELECT COUNT(*) FROM plan_menu_slots WHERE plan_menu_id=pm.id AND primary_item_id IS NOT NULL) as slots_filled
            FROM subscription_plans sp
            LEFT JOIN plan_menus pm ON sp.plan_menu_id=pm.id
            WHERE sp.status='active' ORDER BY sp.price ASC
        `));
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/subscription-plans', verifyToken, async (req, res) => {
    try {
        const { name, duration_days, num_deliveries, diet_type, price, meal_types, plan_menu_id, delivery_days } = req.body;
        if (!name || !duration_days || !num_deliveries || !diet_type || !price || !meal_types)
            return res.status(400).json({ error: 'Missing required fields' });
        const deliveryDaysStr = Array.isArray(delivery_days) ? delivery_days.join(',') : (delivery_days || '1,2,3,4,5,6');
        const r = await db.one(`INSERT INTO subscription_plans (name,duration_days,num_deliveries,diet_type,price,meal_types,plan_menu_id,delivery_days) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [name, duration_days, num_deliveries, diet_type, price, meal_types, plan_menu_id || null, deliveryDaysStr]);
        res.status(201).json({ message: 'Created', planId: r.id });
    } catch(e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/admin/subscription-plans/:id', verifyToken, async (req, res) => {
    try { await db.query(`UPDATE subscription_plans SET status='inactive' WHERE id=$1`, [req.params.id]); res.json({ message: 'Deleted' }); }
    catch(e) { res.status(500).json({ error: e.message }); }
});

// ==================== ADMIN CUSTOMERS ====================
app.get('/api/admin/customers', verifyToken, async (req, res) => {
    try {
        res.json(await db.all(`SELECT c.*,t.name as territory_name,COUNT(o.id)::int as total_orders FROM customers c LEFT JOIN territories t ON c.territory_id=t.id LEFT JOIN orders o ON o.customer_id=c.id WHERE c.status='active' GROUP BY c.id,t.name ORDER BY c.created_at DESC`));
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/customers', verifyToken, async (req, res) => {
    try {
        const { name, email, phone, address, territory_id, diet_preference } = req.body;
        if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
        const r = await db.one(`INSERT INTO customers (name,email,phone,address,territory_id,diet_preference) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [name, email, phone || '', address || '', territory_id || null, diet_preference || 'non_veg']);
        res.status(201).json({ message: 'Created', customerId: r.id });
    } catch(e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/admin/customers/:id', verifyToken, async (req, res) => {
    try { await db.query(`UPDATE customers SET status='inactive' WHERE id=$1`, [req.params.id]); res.json({ message: 'Deleted' }); }
    catch(e) { res.status(500).json({ error: e.message }); }
});

// ==================== ADMIN ORDERS ====================
app.get('/api/admin/orders', verifyToken, async (req, res) => {
    try {
        res.json(await db.all(`SELECT o.*,c.name as customer_name,c.phone as customer_phone,c.diet_preference,p.name as plan_name,k.name as kitchen_name FROM orders o LEFT JOIN customers c ON o.customer_id=c.id LEFT JOIN subscription_plans p ON o.plan_id=p.id LEFT JOIN kitchens k ON o.kitchen_id=k.id ORDER BY o.created_at DESC`));
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/orders', verifyToken, async (req, res) => {
    try {
        const { customer_id, plan_id, kitchen_id, start_date, paid_amount, notes, menu_start_slot } = req.body;
        if (!customer_id || !plan_id || !start_date)
            return res.status(400).json({ error: 'Customer, plan and start date required' });

        const plan = await db.one(`SELECT * FROM subscription_plans WHERE id=$1`, [plan_id]);
        if (!plan) return res.status(404).json({ error: 'Plan not found' });

        const customer = await db.one(`SELECT * FROM customers WHERE id=$1`, [customer_id]);
        if (!customer) return res.status(404).json({ error: 'Customer not found' });

        const vegCustomer = isVegCustomer(customer.diet_preference);

        // Parse delivery days for this plan (e.g. [1,3,6] = Mon,Wed,Sat)
        const deliveryDays = (plan.delivery_days || '1,2,3,4,5,6').split(',').map(Number);

        // Load ALL 24 menu slots if plan has a menu
        let allMenuSlots = [];
        if (plan.plan_menu_id) {
            allMenuSlots = await db.all(
                `SELECT * FROM plan_menu_slots WHERE plan_menu_id=$1 ORDER BY slot_number`,
                [plan.plan_menu_id]
            );
        }

        // Filter master slots to only those matching plan delivery days
        // A slot's weekday = ((slot_number-1) % 6) + 1
        const planSlots = allMenuSlots.filter(s => deliveryDays.includes(s.weekday));
        // planSlots is now ordered by slot_number, only matching weekdays
        // e.g. Mon/Wed/Sat plan: slots [1,3,6, 7,9,12, 13,15,18, 19,21,24]

        // startSlot: which index in planSlots to begin from (0-based)
        const startSlotNum = parseInt(menu_start_slot) || 1;
        // Find starting index in planSlots
        let startIdx = 0;
        if (planSlots.length > 0) {
            const found = planSlots.findIndex(s => s.slot_number >= startSlotNum);
            startIdx = found >= 0 ? found : 0;
        }

        const mealTypes = plan.meal_types ? plan.meal_types.split(',').map(s => s.trim()) : ['lunch'];
        const numDeliveries = plan.num_deliveries || 24;

        // Generate actual calendar dates for this plan's delivery days
        // We need numDeliveries dates that match the plan's delivery days (no Sundays ever)
        function genDatesForDays(startStr, count, allowedWeekdays) {
            const dates = [];
            const d = new Date(startStr + 'T12:00:00Z');
            while (dates.length < count) {
                const dow = d.getUTCDay(); // 0=Sun,1=Mon...6=Sat
                if (dow !== 0 && allowedWeekdays.includes(dow)) {
                    dates.push(d.toISOString().split('T')[0]);
                }
                d.setUTCDate(d.getUTCDate() + 1);
            }
            return dates;
        }

        const dates = genDatesForDays(start_date, numDeliveries, deliveryDays);
        const end_date = dates[dates.length - 1];

        // Calculate next_start_slot for renewal:
        // After using numDeliveries slots from planSlots starting at startIdx,
        // next order should start at (startIdx + numDeliveries) % planSlots.length
        let nextStartSlot = 1;
        if (planSlots.length > 0) {
            const nextIdx = (startIdx + numDeliveries) % planSlots.length;
            nextStartSlot = planSlots[nextIdx]?.slot_number || 1;
        }

        const ord = await db.one(
            `INSERT INTO orders (customer_id,plan_id,kitchen_id,start_date,end_date,menu_start_slot,total_amount,paid_amount,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
            [customer_id, plan_id, kitchen_id||null, start_date, end_date, startSlotNum, plan.price, paid_amount||0, notes||'']
        );

        // Insert deliveries — each date maps to the corresponding planSlot (cycling through)
        for (let i = 0; i < dates.length; i++) {
            const ds = dates[i];
            const slotIdx = (startIdx + i) % (planSlots.length || 1);
            const slot = planSlots.length > 0 ? planSlots[slotIdx] : null;

            for (const mt of mealTypes) {
                let mealItemId = null;
                if (slot) mealItemId = pickItemForCustomer(slot, customer.diet_preference);

                await db.query(
                    `INSERT INTO deliveries (order_id,customer_id,kitchen_id,delivery_date,meal_type,slot_number,meal_item_id,is_veg_customer,status,is_sunday_skip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',0)`,
                    [ord.id, customer_id, kitchen_id||null, ds, mt, slot?.slot_number||null, mealItemId, vegCustomer?1:0]
                );
            }
        }

        res.status(201).json({
            message: 'Order created', orderId: ord.id,
            deliveries: dates.length * mealTypes.length,
            vegCustomer, nextStartSlot,
            startSlot: startSlotNum, endDate: end_date
        });
    } catch(e) { console.error(e); res.status(400).json({ error: e.message }); }
});

// Renew order — creates a new order starting from next slot window
app.post('/api/admin/orders/renew/:id', verifyToken, async (req, res) => {
    try {
        const prevOrder = await db.one(`SELECT o.*,p.delivery_days,p.num_deliveries FROM orders o LEFT JOIN subscription_plans p ON o.plan_id=p.id WHERE o.id=$1`, [req.params.id]);
        if (!prevOrder) return res.status(404).json({ error: 'Order not found' });

        // Get all plan slots filtered by delivery_days
        const allMenuSlots = await db.all(`SELECT * FROM plan_menu_slots WHERE plan_menu_id=(SELECT plan_menu_id FROM subscription_plans WHERE id=$1) ORDER BY slot_number`, [prevOrder.plan_id]);
        const deliveryDays = (prevOrder.delivery_days || '1,2,3,4,5,6').split(',').map(Number);
        const planSlots = allMenuSlots.filter(s => deliveryDays.includes(s.weekday));

        if (!planSlots.length) return res.status(400).json({ error: 'Plan has no menu slots configured' });

        // Find where previous order started, calculate next start
        const prevStartIdx = planSlots.findIndex(s => s.slot_number >= (prevOrder.menu_start_slot || 1));
        const nextIdx = (Math.max(prevStartIdx,0) + (prevOrder.num_deliveries || 24)) % planSlots.length;
        const nextStartSlot = planSlots[nextIdx].slot_number;

        // New order starts day after previous end date
        const prevEnd = toDS(prevOrder.end_date);
        const newStart = nextWorkDay(prevEnd);

        // Delegate to main order creation
        req.body = {
            customer_id: prevOrder.customer_id,
            plan_id: prevOrder.plan_id,
            kitchen_id: prevOrder.kitchen_id,
            start_date: newStart,
            paid_amount: 0,
            notes: `Renewal of order #${prevOrder.id}`,
            menu_start_slot: nextStartSlot
        };

        // Re-run order creation logic by calling itself recursively via internal fetch isn't clean
        // Instead return the params so admin can confirm
        res.json({
            message: 'Renewal ready',
            suggestedStart: newStart,
            nextStartSlot,
            planId: prevOrder.plan_id,
            customerId: prevOrder.customer_id
        });
    } catch(e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/admin/orders/:id/status', verifyToken, async (req, res) => {
    try {
        const { order_status, payment_status, paid_amount } = req.body;
        await db.query(`UPDATE orders SET order_status=COALESCE($1,order_status),payment_status=COALESCE($2,payment_status),paid_amount=COALESCE($3,paid_amount) WHERE id=$4`,
            [order_status || null, payment_status || null, paid_amount || null, req.params.id]);
        res.json({ message: 'Updated' });
    } catch(e) { res.status(400).json({ error: e.message }); }
});

// ==================== ADMIN DELIVERIES ====================
app.get('/api/admin/deliveries', verifyToken, async (req, res) => {
    try {
        const { date, status, kitchen_id } = req.query;
        const params = [];
        let where = 'WHERE d.is_sunday_skip=0';
        if (date) { params.push(date); where += ` AND d.delivery_date=$${params.length}`; }
        if (status) { params.push(status); where += ` AND d.status=$${params.length}`; }
        if (kitchen_id) { params.push(parseInt(kitchen_id)); where += ` AND d.kitchen_id=$${params.length}`; }
        res.json(await db.all(`
            SELECT d.*,c.name as customer_name,c.phone as customer_phone,c.address as customer_address,
                c.diet_preference,k.name as kitchen_name,
                mi.name as meal_item_name,mc.name as category_name
            FROM deliveries d
            LEFT JOIN customers c ON d.customer_id=c.id
            LEFT JOIN kitchens k ON d.kitchen_id=k.id
            LEFT JOIN meal_items mi ON d.meal_item_id=mi.id
            LEFT JOIN meal_categories mc ON mi.category_id=mc.id
            ${where}
            ORDER BY d.delivery_date DESC,
                CASE d.meal_type WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'dinner' THEN 3 ELSE 4 END
        `, params));
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/admin/deliveries/:id/status', verifyToken, async (req, res) => {
    try {
        const { status, delivery_agent, notes } = req.body;
        const da = status === 'delivered' ? new Date().toISOString() : null;
        await db.query(`UPDATE deliveries SET status=$1,delivery_agent=COALESCE($2,delivery_agent),notes=COALESCE($3,notes),delivered_at=COALESCE($4,delivered_at) WHERE id=$5`,
            [status, delivery_agent || null, notes || null, da, req.params.id]);
        res.json({ message: 'Updated' });
    } catch(e) { res.status(400).json({ error: e.message }); }
});

// ==================== HEALTH ====================
app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ==================== STATIC FILES ====================
app.use(express.static(path.join(__dirname, 'public')));

app.get('/customer', (req, res) => {
    const f = path.join(__dirname, 'public', 'customer.html');
    if (fs.existsSync(f)) return res.sendFile(f);
    res.status(404).send('Not found');
});
app.get('/kitchen', (req, res) => {
    const f = path.join(__dirname, 'public', 'kitchen.html');
    if (fs.existsSync(f)) return res.sendFile(f);
    res.status(404).send('Kitchen portal not found');
});
app.get('/', (req, res) => {
    const f = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(f)) return res.sendFile(f);
    res.send('<h1>Salad Caffe</h1>');
});
app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    const f = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(f)) return res.sendFile(f);
    next();
});
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: err.message }); });

async function start() {
    try { await initDB(); } catch(e) { console.error('DB init failed:', e.message); }
    app.listen(PORT, () => {
        console.log(`✅ Port ${PORT}`);
        console.log(`📍 Admin:    http://localhost:${PORT}/`);
        console.log(`📍 Customer: http://localhost:${PORT}/customer`);
        console.log(`📍 Kitchen:  http://localhost:${PORT}/kitchen`);
    });
}
// ===== PLAN MENU GENERATOR =====
// Algorithm:
// 1. Admin picks ordered categories → system maps to weekdays
// 2. 24 slots built: slot weekday = (slot-1)%6 + 1 (1=Mon...6=Sat)
// 3. Each category gets ceil(24/numCats) slots, distributed evenly
// 4. Items rotate within category across weeks, no same-week repeat
// 5. Veg/non-veg: odd slot = veg day (primary=veg, alt=non-veg), even = non-veg day

app.post('/api/admin/plan-menu/generate', verifyToken, async (req, res) => {
    try {
        const { categories, meal_type } = req.body;
        // categories: [{id, name}] ordered — order determines weekday assignment
        if (!categories || !categories.length)
            return res.status(400).json({ error: 'At least one category required' });

        const numCats = categories.length;
        const TOTAL_SLOTS = 24;
        const WEEKDAYS = 6; // Mon-Sat

        // Map categories to weekdays
        // If numCats <= 6: spread evenly, some weekdays share a category
        // If numCats > 6: rotate which category appears on each weekday per week
        
        // weekdayCategory(slot): which category index applies to this slot
        function getCategoryForSlot(slotNum) {
            const weekday = ((slotNum - 1) % WEEKDAYS) + 1; // 1-6
            const week = Math.floor((slotNum - 1) / WEEKDAYS); // 0-3
            
            if (numCats <= WEEKDAYS) {
                // Option B: distribute evenly, some days share a category
                // e.g. 4 cats, 6 days: each cat gets floor(6/4)=1 day, remainder shared
                // Simple approach: spread across weekdays
                const daysPerCat = WEEKDAYS / numCats; // may not be integer
                const catIndex = Math.floor((weekday - 1) / daysPerCat);
                return Math.min(catIndex, numCats - 1);
            } else {
                // More than 6 categories: rotate which category maps to each weekday each week
                const catIndex = ((weekday - 1) + week) % numCats;
                return catIndex;
            }
        }

        // Load all items for each category, split by veg/non-veg
        const catItems = {};
        for (const cat of categories) {
            const vegItems = await db.all(
                `SELECT id,name,calories,veg_tag,non_veg_tag FROM meal_items 
                 WHERE category_id=$1 AND status='active' AND veg_tag=1 ORDER BY id`, [cat.id]);
            const nonVegItems = await db.all(
                `SELECT id,name,calories,veg_tag,non_veg_tag FROM meal_items 
                 WHERE category_id=$1 AND status='active' AND non_veg_tag=1 ORDER BY id`, [cat.id]);
            catItems[cat.id] = { veg: vegItems, nonVeg: nonVegItems };
        }

        // Track item usage per category per week to avoid same-week repeats
        // usageMap[catId][week] = { vegIdx, nonVegIdx }
        const usageMap = {};
        for (const cat of categories) {
            usageMap[cat.id] = {};
            for (let w = 0; w < 4; w++) usageMap[cat.id][w] = { vegIdx: 0, nonVegIdx: 0 };
        }

        const slots = [];
        const warnings = [];

        for (let slot = 1; slot <= TOTAL_SLOTS; slot++) {
            const catIdx = getCategoryForSlot(slot);
            const cat = categories[catIdx];
            const weekday = ((slot - 1) % WEEKDAYS) + 1;
            const week = Math.floor((slot - 1) / WEEKDAYS);
            const dayType = slot % 2 === 1 ? 'veg' : 'non_veg';
            const items = catItems[cat.id];
            const usage = usageMap[cat.id][week];

            // Pick veg item (primary on veg day, alternate on non-veg day)
            let vegItem = null, nonVegItem = null;

            if (items.veg.length > 0) {
                vegItem = items.veg[usage.vegIdx % items.veg.length];
                usage.vegIdx++;
                if (items.veg.length < 4) {
                    warnings.push(`Category "${cat.name}" has only ${items.veg.length} veg item(s) — some will repeat`);
                }
            } else {
                warnings.push(`Category "${cat.name}" has NO veg items — slot ${slot} veg unassigned`);
            }

            if (items.nonVeg.length > 0) {
                nonVegItem = items.nonVeg[usage.nonVegIdx % items.nonVeg.length];
                usage.nonVegIdx++;
                if (items.nonVeg.length < 4) {
                    warnings.push(`Category "${cat.name}" has only ${items.nonVeg.length} non-veg item(s) — some will repeat`);
                }
            } else {
                warnings.push(`Category "${cat.name}" has NO non-veg items — slot ${slot} non-veg unassigned`);
            }

            // primary = matching day type, alternate = opposite
            const primaryItem = dayType === 'veg' ? vegItem : nonVegItem;
            const alternateItem = dayType === 'veg' ? nonVegItem : vegItem;

            slots.push({
                slot_number: slot,
                weekday,
                week: week + 1,
                day_type: dayType,
                category_id: cat.id,
                category_name: cat.name,
                primary_item_id: primaryItem?.id || null,
                primary_item_name: primaryItem?.name || null,
                primary_calories: primaryItem?.calories || null,
                alternate_item_id: alternateItem?.id || null,
                alternate_item_name: alternateItem?.name || null,
                alternate_calories: alternateItem?.calories || null,
            });
        }

        // Deduplicate warnings
        const uniqueWarnings = [...new Set(warnings)];

        res.json({ slots, warnings: uniqueWarnings, total: slots.length });
    } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// Save generated slots to a plan menu
app.post('/api/admin/plan-menus/save-generated', verifyToken, async (req, res) => {
    try {
        const { name, meal_type, slots } = req.body;
        if (!name || !slots?.length) return res.status(400).json({ error: 'Name and slots required' });
        
        // Create menu header
        const menu = await db.one(`INSERT INTO plan_menus (name,meal_type) VALUES ($1,$2) RETURNING id`,
            [name, meal_type || 'lunch']);
        
        // Insert all 24 slots
        for (const s of slots) {
            await db.query(`
                INSERT INTO plan_menu_slots 
                (plan_menu_id,slot_number,weekday,day_type,category_id,primary_item_id,alternate_item_id)
                VALUES ($1,$2,$3,$4,$5,$6,$7)
                ON CONFLICT (plan_menu_id,slot_number) DO UPDATE SET
                weekday=$3,day_type=$4,category_id=$5,primary_item_id=$6,alternate_item_id=$7
            `, [menu.id, s.slot_number, s.weekday, s.day_type, s.category_id||null, s.primary_item_id||null, s.alternate_item_id||null]);
        }
        
        res.status(201).json({ message: 'Plan menu saved', menuId: menu.id });
    } catch(e) { res.status(400).json({ error: e.message }); }
});


// ===== PLAN MENUS =====

app.get('/api/customer/profile', verifyToken, reqCust, async (req, res) => {
    try {
        const c = await db.one(`SELECT c.*,t.name as territory_name FROM customers c LEFT JOIN territories t ON c.territory_id=t.id WHERE c.user_id=$1`, [req.user.id]);
        if (!c) return res.status(404).json({ error: 'Not found' });
        res.json(c);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/customer/profile', verifyToken, reqCust, async (req, res) => {
    try {
        const { name, phone, address, alternate_address, allergies, health_notes, diet_preference } = req.body;
        await db.query(`UPDATE customers SET name=$1,phone=$2,address=$3,alternate_address=$4,allergies=$5,health_notes=$6,diet_preference=$7 WHERE user_id=$8`,
            [name, phone, address, alternate_address, allergies, health_notes, diet_preference, req.user.id]);
        await db.query(`UPDATE users SET name=$1,phone=$2 WHERE id=$3`, [name, phone, req.user.id]);
        res.json({ message: 'Updated' });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/customer/subscriptions', verifyToken, reqCust, async (req, res) => {
    try {
        const c = await db.one(`SELECT * FROM customers WHERE user_id=$1`, [req.user.id]);
        if (!c) return res.status(404).json({ error: 'Not found' });
        res.json(await db.all(`
            SELECT o.*,
                p.name as plan_name, p.diet_type, p.meal_types, p.duration_days, p.num_deliveries,
                k.name as kitchen_name,
                (SELECT COUNT(*)::int FROM deliveries WHERE order_id=o.id AND status='delivered') as delivered_count,
                (SELECT COUNT(*)::int FROM deliveries WHERE order_id=o.id AND status='pending') as pending_count,
                (SELECT COUNT(*)::int FROM deliveries WHERE order_id=o.id AND status='skipped' AND is_sunday_skip=0) as skipped_count
            FROM orders o
            LEFT JOIN subscription_plans p ON o.plan_id=p.id
            LEFT JOIN kitchens k ON o.kitchen_id=k.id
            WHERE o.customer_id=$1 ORDER BY o.created_at DESC
        `, [c.id]));
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/customer/calendar', verifyToken, reqCust, async (req, res) => {
    try {
        const c = await db.one(`SELECT * FROM customers WHERE user_id=$1`, [req.user.id]);
        const { month } = req.query;
        if (!month) return res.status(400).json({ error: 'month required (YYYY-MM)' });
        res.json(await db.all(`
            SELECT d.*, mi.name as meal_item_name, mi.calories, mi.veg_tag, mi.non_veg_tag,
                mc.name as category_name, p.name as plan_name, p.diet_type, k.name as kitchen_name
            FROM deliveries d
            LEFT JOIN meal_items mi ON d.meal_item_id=mi.id
            LEFT JOIN meal_categories mc ON mi.category_id=mc.id
            LEFT JOIN orders o ON d.order_id=o.id
            LEFT JOIN subscription_plans p ON o.plan_id=p.id
            LEFT JOIN kitchens k ON d.kitchen_id=k.id
            WHERE d.customer_id=$1 AND d.is_sunday_skip=0
              AND d.delivery_date>=($2||'-01')::date AND d.delivery_date<=($2||'-31')::date
            ORDER BY d.delivery_date ASC,
                CASE d.meal_type WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'dinner' THEN 3 ELSE 4 END
        `, [c.id, month]));
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/customer/upcoming-meals', verifyToken, reqCust, async (req, res) => {
    try {
        const c = await db.one(`SELECT * FROM customers WHERE user_id=$1`, [req.user.id]);
        // Only today and tomorrow as requested
        res.json(await db.all(`
            SELECT d.*, mi.name as meal_item_name, mi.calories, mi.veg_tag, mi.non_veg_tag,
                mc.name as category_name, p.name as plan_name, k.name as kitchen_name
            FROM deliveries d
            LEFT JOIN meal_items mi ON d.meal_item_id=mi.id
            LEFT JOIN meal_categories mc ON mi.category_id=mc.id
            LEFT JOIN orders o ON d.order_id=o.id
            LEFT JOIN subscription_plans p ON o.plan_id=p.id
            LEFT JOIN kitchens k ON d.kitchen_id=k.id
            WHERE d.customer_id=$1 AND d.is_sunday_skip=0
              AND d.delivery_date >= CURRENT_DATE
              AND d.delivery_date <= CURRENT_DATE + INTERVAL '1 day'
            ORDER BY d.delivery_date ASC,
                CASE d.meal_type WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'dinner' THEN 3 ELSE 4 END
        `, [c.id]));
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/customer/delivery-history', verifyToken, reqCust, async (req, res) => {
    try {
        const c = await db.one(`SELECT * FROM customers WHERE user_id=$1`, [req.user.id]);
        res.json(await db.all(`
            SELECT d.*, mi.name as meal_item_name, mc.name as category_name, p.name as plan_name
            FROM deliveries d
            LEFT JOIN meal_items mi ON d.meal_item_id=mi.id
            LEFT JOIN meal_categories mc ON mi.category_id=mc.id
            LEFT JOIN orders o ON d.order_id=o.id
            LEFT JOIN subscription_plans p ON o.plan_id=p.id
            WHERE d.customer_id=$1 AND d.delivery_date<CURRENT_DATE AND d.is_sunday_skip=0
            ORDER BY d.delivery_date DESC LIMIT 60
        `, [c.id]));
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/customer/skip-meal/:id', verifyToken, reqCust, async (req, res) => {
    try {
        const c = await db.one(`SELECT * FROM customers WHERE user_id=$1`, [req.user.id]);
        const d = await db.one(`SELECT * FROM deliveries WHERE id=$1 AND customer_id=$2`, [req.params.id, c.id]);
        if (!d) return res.status(404).json({ error: 'Delivery not found' });
        if (d.status !== 'pending') return res.status(400).json({ error: 'Cannot skip — already ' + d.status });
        const dl = new Date(toDS(d.delivery_date) + 'T22:00:00');
        dl.setDate(dl.getDate() - 1);
        if (new Date() > dl) return res.status(400).json({ error: 'Skip deadline passed (10 PM previous night)' });
        const { reason } = req.body;
        await db.query(`UPDATE deliveries SET status='skipped',skipped_reason=$1 WHERE id=$2`,
            [reason || 'Customer request', d.id]);
        await db.query(`INSERT INTO meal_skip_log (delivery_id,customer_id,reason) VALUES ($1,$2,$3)`,
            [d.id, c.id, reason || 'Customer request']);
        const order = await db.one(`SELECT * FROM orders WHERE id=$1`, [d.order_id]);
        if (order && order.extended_days < 45) {
            const ne = nextWorkDay(toDS(order.end_date));
            await db.query(`UPDATE orders SET end_date=$1,extended_days=extended_days+1 WHERE id=$2`, [ne, order.id]);
        }
        res.json({ message: `Meal skipped. Subscription extended by 1 working day. No refund.` });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/customer/pause-subscription/:id', verifyToken, reqCust, async (req, res) => {
    try {
        const c = await db.one(`SELECT * FROM customers WHERE user_id=$1`, [req.user.id]);
        const order = await db.one(`SELECT * FROM orders WHERE id=$1 AND customer_id=$2`, [req.params.id, c.id]);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        if (order.order_status !== 'active') return res.status(400).json({ error: 'Order not active' });
        const { pause_start, pause_end } = req.body;
        if (!pause_start || !pause_end) return res.status(400).json({ error: 'Dates required' });
        const days = Math.ceil((new Date(pause_end) - new Date(pause_start)) / 86400000);
        if (days < 1 || days > 30) return res.status(400).json({ error: 'Pause must be 1-30 days' });
        let ext = 0;
        const cur = new Date(pause_start + 'T12:00:00Z');
        const ed = new Date(pause_end + 'T12:00:00Z');
        while (cur <= ed) { if (cur.getUTCDay() !== 0) ext++; cur.setUTCDate(cur.getUTCDate() + 1); }
        await db.query(`UPDATE deliveries SET status='skipped',skipped_reason='Subscription paused' WHERE order_id=$1 AND delivery_date>=$2 AND delivery_date<=$3 AND status='pending' AND is_sunday_skip=0`,
            [order.id, pause_start, pause_end]);
        let ne = new Date(toDS(order.end_date) + 'T12:00:00Z');
        let added = 0;
        while (added < ext) { ne.setUTCDate(ne.getUTCDate() + 1); if (ne.getUTCDay() !== 0) added++; }
        await db.query(`UPDATE orders SET order_status='paused',pause_start=$1,pause_end=$2,end_date=$3 WHERE id=$4`,
            [pause_start, pause_end, ne.toISOString().split('T')[0], order.id]);
        res.json({ message: `Paused. End date extended. No refund for paused days.` });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/customer/cancel-subscription/:id', verifyToken, reqCust, async (req, res) => {
    try {
        const c = await db.one(`SELECT * FROM customers WHERE user_id=$1`, [req.user.id]);
        const order = await db.one(`SELECT * FROM orders WHERE id=$1 AND customer_id=$2`, [req.params.id, c.id]);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        if (['cancelled','completed'].includes(order.order_status))
            return res.status(400).json({ error: 'Already ' + order.order_status });
        await db.query(`UPDATE orders SET order_status='cancelled' WHERE id=$1`, [order.id]);
        await db.query(`UPDATE deliveries SET status='skipped',skipped_reason='Cancelled by customer' WHERE order_id=$1 AND status='pending'`, [order.id]);
        res.json({ message: 'Cancelled. No refund as per policy.' });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/customer/plans', async (req, res) => {
    try { res.json(await db.all(`SELECT * FROM subscription_plans WHERE status='active' ORDER BY price ASC`)); }
    catch(e) { res.status(500).json({ error: e.message }); }
});

// ==================== KITCHEN DASHBOARD APIs ====================

// Kitchen daily summary — the main report
// Returns: per meal_type → items to prepare with counts, split by veg/non-veg
// Then: skipped breakdown by veg/non-veg
// Then: net to prepare
app.get('/api/kitchen/daily-summary', verifyToken, reqKitchen, async (req, res) => {
    try {
        const { date, kitchen_id } = req.query;
        const targetDate = date || new Date().toISOString().split('T')[0];

        // Params
        const params = [targetDate];
        let kitchenFilter = '';
        if (kitchen_id) {
            params.push(parseInt(kitchen_id));
            kitchenFilter = `AND d.kitchen_id=$${params.length}`;
        }

        // All deliveries for this date, excluding Sundays and sunday_skip rows
        const allDeliveries = await db.all(`
            SELECT
                d.id, d.meal_type, d.status, d.is_veg_customer,
                d.meal_item_id, mi.name as meal_item_name,
                mi.veg_tag, mi.non_veg_tag, mi.eggetarian_tag, mi.vegan_tag,
                mi.calories, mi.image_base64,
                c.name as customer_name, c.phone as customer_phone,
                c.address as customer_address, c.diet_preference
            FROM deliveries d
            LEFT JOIN meal_items mi ON d.meal_item_id=mi.id
            LEFT JOIN customers c ON d.customer_id=c.id
            WHERE d.delivery_date=$1 AND d.is_sunday_skip=0
            ${kitchenFilter}
            ORDER BY d.meal_type, mi.name, c.name
        `, params);

        // Group by meal_type
        const mealTypes = [...new Set(allDeliveries.map(d => d.meal_type))];
        const summary = {};

        for (const mt of mealTypes) {
            const rows = allDeliveries.filter(d => d.meal_type === mt);
            const pending = rows.filter(d => d.status === 'pending');
            const skipped = rows.filter(d => d.status === 'skipped');
            const delivered = rows.filter(d => d.status === 'delivered');

            // Group pending by meal item
            const itemGroups = {};
            for (const r of pending) {
                const key = r.meal_item_id || 'unassigned';
                if (!itemGroups[key]) {
                    itemGroups[key] = {
                        meal_item_id: r.meal_item_id,
                        meal_item_name: r.meal_item_name || 'Not assigned',
                        calories: r.calories,
                        image_base64: r.image_base64,
                        veg_tag: r.veg_tag,
                        non_veg_tag: r.non_veg_tag,
                        total: 0, veg_count: 0, non_veg_count: 0
                    };
                }
                itemGroups[key].total++;
                if (r.is_veg_customer) itemGroups[key].veg_count++;
                else itemGroups[key].non_veg_count++;
            }

            // Skipped breakdown
            const skippedVeg = skipped.filter(d => d.is_veg_customer).length;
            const skippedNonVeg = skipped.filter(d => !d.is_veg_customer).length;

            // Delivered breakdown
            const deliveredVeg = delivered.filter(d => d.is_veg_customer).length;
            const deliveredNonVeg = delivered.filter(d => !d.is_veg_customer).length;

            summary[mt] = {
                meal_type: mt,
                total_customers: rows.length,
                items_to_prepare: Object.values(itemGroups),
                pending_total: pending.length,
                pending_veg: pending.filter(d => d.is_veg_customer).length,
                pending_non_veg: pending.filter(d => !d.is_veg_customer).length,
                skipped_total: skipped.length,
                skipped_veg: skippedVeg,
                skipped_non_veg: skippedNonVeg,
                delivered_total: delivered.length,
                delivered_veg: deliveredVeg,
                delivered_non_veg: deliveredNonVeg,
                net_to_prepare: pending.length, // pending = not yet delivered or skipped
                net_veg: pending.filter(d => d.is_veg_customer).length,
                net_non_veg: pending.filter(d => !d.is_veg_customer).length,
                customer_list: rows.map(r => ({
                    name: r.customer_name,
                    phone: r.customer_phone,
                    address: r.customer_address,
                    diet: r.diet_preference,
                    item: r.meal_item_name || 'Not assigned',
                    status: r.status,
                    is_veg: !!r.is_veg_customer
                }))
            };
        }

        res.json({ date: targetDate, summary, kitchen_id: kitchen_id || 'all' });
    } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// Kitchen list of kitchens for the login dropdown
app.get('/api/kitchen/list', verifyToken, async (req, res) => {
    try { res.json(await db.all(`SELECT id,name,address FROM kitchens WHERE status='active' ORDER BY name`)); }
    catch(e) { res.status(500).json({ error: e.message }); }
});

// Mark delivery as delivered (kitchen staff action)
app.put('/api/kitchen/delivery/:id/deliver', verifyToken, reqKitchen, async (req, res) => {
    try {
        const { delivery_agent, notes } = req.body;
        await db.query(`UPDATE deliveries SET status='delivered',delivery_agent=$1,notes=$2,delivered_at=NOW() WHERE id=$3`,
            [delivery_agent || null, notes || null, req.params.id]);
        res.json({ message: 'Marked as delivered' });
    } catch(e) { res.status(400).json({ error: e.message }); }
});

// ==================== ADMIN STATS ====================

app.get('/api/admin/stats', verifyToken, async (req, res) => {
    try {
        const [tc,to,ao,tr,pd,td,tm,tp,ro] = await Promise.all([
            db.one(`SELECT COUNT(*)::int as c FROM customers WHERE status='active'`),
            db.one(`SELECT COUNT(*)::int as c FROM orders`),
            db.one(`SELECT COUNT(*)::int as c FROM orders WHERE order_status='active'`),
            db.one(`SELECT COALESCE(SUM(paid_amount),0) as t FROM orders`),
            db.one(`SELECT COUNT(*)::int as c FROM deliveries WHERE status='pending' AND delivery_date=CURRENT_DATE AND is_sunday_skip=0`),
            db.one(`SELECT COUNT(*)::int as c FROM deliveries WHERE delivery_date=CURRENT_DATE AND is_sunday_skip=0`),
            db.one(`SELECT COUNT(*)::int as c FROM meal_items WHERE status='active'`),
            db.one(`SELECT COUNT(*)::int as c FROM subscription_plans WHERE status='active'`),
            db.all(`SELECT o.*,c.name as customer_name,p.name as plan_name FROM orders o LEFT JOIN customers c ON o.customer_id=c.id LEFT JOIN subscription_plans p ON o.plan_id=p.id ORDER BY o.created_at DESC LIMIT 5`)
        ]);
        res.json({ totalCustomers:tc.c, totalOrders:to.c, activeOrders:ao.c, totalRevenue:tr.t, pendingDeliveries:pd.c, todayDeliveries:td.c, totalMeals:tm.c, totalPlans:tp.c, recentOrders:ro });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ==================== ADMIN CATEGORIES ====================
app.get('/api/admin/categories', verifyToken, async (req, res) => {
    try { res.json(await db.all(`SELECT * FROM meal_categories WHERE status='active' ORDER BY name`)); }
    catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/categories', verifyToken, async (req, res) => {
    try {
        const { name, description } = req.body;
        if (!name) return res.status(400).json({ error: 'Name required' });
        const r = await db.one(`INSERT INTO meal_categories (name,description) VALUES ($1,$2) RETURNING id`, [name, description || '']);
        res.status(201).json({ message: 'Created', categoryId: r.id });
    } catch(e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/admin/categories/:id', verifyToken, async (req, res) => {
    try { await db.query(`UPDATE meal_categories SET status='inactive' WHERE id=$1`, [req.params.id]); res.json({ message: 'Deleted' }); }
    catch(e) { res.status(500).json({ error: e.message }); }
});

// ==================== ADMIN MEAL ITEMS ====================
app.get('/api/admin/meal-items', verifyToken, async (req, res) => {
    try { res.json(await db.all(`SELECT m.*,c.name as category_name FROM meal_items m LEFT JOIN meal_categories c ON m.category_id=c.id WHERE m.status='active' ORDER BY c.name,m.name`)); }
    catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/meal-items', verifyToken, async (req, res) => {
    try {
        const { name,category_id,veg_tag,non_veg_tag,eggetarian_tag,vegan_tag,description,ingredients,allergy_info,calories,proteins,carbs,fiber,sugar,vitamins,mrp,image_base64 } = req.body;
        if (!name || !category_id) return res.status(400).json({ error: 'Name and category required' });
        const r = await db.one(`INSERT INTO meal_items (name,category_id,veg_tag,non_veg_tag,eggetarian_tag,vegan_tag,description,ingredients,allergy_info,calories,proteins,carbs,fiber,sugar,vitamins,mrp,image_base64) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
            [name,category_id,veg_tag?1:0,non_veg_tag?1:0,eggetarian_tag?1:0,vegan_tag?1:0,description||'',ingredients||'',allergy_info||'',calories||0,proteins||null,carbs||null,fiber||null,sugar||null,vitamins||'',mrp||0,image_base64||null]);
        res.status(201).json({ message: 'Created', mealItemId: r.id });
    } catch(e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/admin/meal-items/:id', verifyToken, async (req, res) => {
    try { await db.query(`UPDATE meal_items SET status='inactive' WHERE id=$1`, [req.params.id]); res.json({ message: 'Deleted' }); }
    catch(e) { res.status(500).json({ error: e.message }); }
});

// ==================== ADMIN TERRITORIES ====================
app.get('/api/admin/territories', verifyToken, async (req, res) => {
    try { res.json(await db.all(`SELECT * FROM territories WHERE status='active' ORDER BY name`)); }
    catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/territories', verifyToken, async (req, res) => {
    try {
        const { name, description } = req.body;
        if (!name) return res.status(400).json({ error: 'Name required' });
        const r = await db.one(`INSERT INTO territories (name,description) VALUES ($1,$2) RETURNING id`, [name, description || '']);
        res.status(201).json({ message: 'Created', territoryId: r.id });
    } catch(e) { res.status(400).json({ error: e.message }); }
});

// ==================== ADMIN KITCHENS ====================
app.get('/api/admin/kitchens', verifyToken, async (req, res) => {
    try { res.json(await db.all(`SELECT k.*,t.name as territory_name FROM kitchens k LEFT JOIN territories t ON k.territory_id=t.id WHERE k.status='active' ORDER BY k.name`)); }
    catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/kitchens', verifyToken, async (req, res) => {
    try {
        const { name, territory_id, address, capacity } = req.body;
        if (!name || !territory_id) return res.status(400).json({ error: 'Name and territory required' });
        const r = await db.one(`INSERT INTO kitchens (name,territory_id,address,capacity) VALUES ($1,$2,$3,$4) RETURNING id`, [name, territory_id, address || '', capacity || 100]);
        res.status(201).json({ message: 'Created', kitchenId: r.id });
    } catch(e) { res.status(400).json({ error: e.message }); }
});

// ==================== PLAN MENUS (28-day cycle) ====================

// Get all plan menus with their 24 slots
app.get('/api/admin/plan-menus', verifyToken, async (req, res) => {
    try {
        const menus = await db.all(`SELECT * FROM plan_menus WHERE status='active' ORDER BY created_at DESC`);
        // Attach slot counts
        for (const m of menus) {
            const slots = await db.all(`
                SELECT pms.*,
                    mc.name as category_name,
                    pi.name as primary_item_name, pi.veg_tag as primary_veg, pi.non_veg_tag as primary_non_veg, pi.image_base64 as primary_image, pi.calories as primary_calories,
                    ai.name as alternate_item_name, ai.veg_tag as alt_veg, ai.non_veg_tag as alt_non_veg, ai.calories as alt_calories
                FROM plan_menu_slots pms
                LEFT JOIN meal_categories mc ON pms.category_id=mc.id
                LEFT JOIN meal_items pi ON pms.primary_item_id=pi.id
                LEFT JOIN meal_items ai ON pms.alternate_item_id=ai.id
                WHERE pms.plan_menu_id=$1 ORDER BY pms.slot_number
            `, [m.id]);
            m.slots = slots;
            m.slots_filled = slots.filter(s => s.primary_item_id).length;
        }
        res.json(menus);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Create a new plan menu (just the header — slots added separately)
app.post('/api/admin/plan-menus', verifyToken, async (req, res) => {
    try {
        const { name, meal_type } = req.body;
        if (!name) return res.status(400).json({ error: 'Name required' });
        const r = await db.one(`INSERT INTO plan_menus (name,meal_type) VALUES ($1,$2) RETURNING id`,
            [name, meal_type || 'lunch']);
        // Pre-create 24 empty slots with weekday
        for (let i = 1; i <= 24; i++) {
            const dayType = i % 2 === 1 ? 'veg' : 'non_veg';
            const weekday = ((i - 1) % 6) + 1;
            await db.query(`INSERT INTO plan_menu_slots (plan_menu_id,slot_number,weekday,day_type) VALUES ($1,$2,$3,$4)`,
                [r.id, i, weekday, dayType]);
        }
        res.status(201).json({ message: 'Plan menu created with 24 slots', menuId: r.id });
    } catch(e) { res.status(400).json({ error: e.message }); }
});

// Update a single slot (assign primary + alternate items)
app.put('/api/admin/plan-menus/:menuId/slots/:slotNum', verifyToken, async (req, res) => {
    try {
        const { primary_item_id, alternate_item_id } = req.body;
        const { category_id } = req.body;
        await db.query(`UPDATE plan_menu_slots SET primary_item_id=$1,alternate_item_id=$2,category_id=COALESCE($3,category_id) WHERE plan_menu_id=$4 AND slot_number=$5`,
            [primary_item_id || null, alternate_item_id || null, category_id || null, req.params.menuId, req.params.slotNum]);
        res.json({ message: 'Slot updated' });
    } catch(e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/admin/plan-menus/:id', verifyToken, async (req, res) => {
    try {
        await db.query(`DELETE FROM plan_menu_slots WHERE plan_menu_id=$1`, [req.params.id]);
        await db.query(`UPDATE plan_menus SET status='inactive' WHERE id=$1`, [req.params.id]);
        res.json({ message: 'Deleted' });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ==================== ADMIN PLANS ====================
app.get('/api/admin/subscription-plans', verifyToken, async (req, res) => {
    try {
        res.json(await db.all(`
            SELECT sp.*, pm.name as plan_menu_name, pm.meal_type as plan_menu_meal_type,
                (SELECT COUNT(*) FROM plan_menu_slots WHERE plan_menu_id=pm.id AND primary_item_id IS NOT NULL) as slots_filled
            FROM subscription_plans sp
            LEFT JOIN plan_menus pm ON sp.plan_menu_id=pm.id
            WHERE sp.status='active' ORDER BY sp.price ASC
        `));
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/subscription-plans', verifyToken, async (req, res) => {
    try {
        const { name, duration_days, num_deliveries, diet_type, price, meal_types, plan_menu_id, delivery_days } = req.body;
        if (!name || !duration_days || !num_deliveries || !diet_type || !price || !meal_types)
            return res.status(400).json({ error: 'Missing required fields' });
        const deliveryDaysStr = Array.isArray(delivery_days) ? delivery_days.join(',') : (delivery_days || '1,2,3,4,5,6');
        const r = await db.one(`INSERT INTO subscription_plans (name,duration_days,num_deliveries,diet_type,price,meal_types,plan_menu_id,delivery_days) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [name, duration_days, num_deliveries, diet_type, price, meal_types, plan_menu_id || null, deliveryDaysStr]);
        res.status(201).json({ message: 'Created', planId: r.id });
    } catch(e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/admin/subscription-plans/:id', verifyToken, async (req, res) => {
    try { await db.query(`UPDATE subscription_plans SET status='inactive' WHERE id=$1`, [req.params.id]); res.json({ message: 'Deleted' }); }
    catch(e) { res.status(500).json({ error: e.message }); }
});

// ==================== ADMIN CUSTOMERS ====================
app.get('/api/admin/customers', verifyToken, async (req, res) => {
    try {
        res.json(await db.all(`SELECT c.*,t.name as territory_name,COUNT(o.id)::int as total_orders FROM customers c LEFT JOIN territories t ON c.territory_id=t.id LEFT JOIN orders o ON o.customer_id=c.id WHERE c.status='active' GROUP BY c.id,t.name ORDER BY c.created_at DESC`));
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/customers', verifyToken, async (req, res) => {
    try {
        const { name, email, phone, address, territory_id, diet_preference } = req.body;
        if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
        const r = await db.one(`INSERT INTO customers (name,email,phone,address,territory_id,diet_preference) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [name, email, phone || '', address || '', territory_id || null, diet_preference || 'non_veg']);
        res.status(201).json({ message: 'Created', customerId: r.id });
    } catch(e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/admin/customers/:id', verifyToken, async (req, res) => {
    try { await db.query(`UPDATE customers SET status='inactive' WHERE id=$1`, [req.params.id]); res.json({ message: 'Deleted' }); }
    catch(e) { res.status(500).json({ error: e.message }); }
});

// ==================== ADMIN ORDERS ====================
app.get('/api/admin/orders', verifyToken, async (req, res) => {
    try {
        res.json(await db.all(`SELECT o.*,c.name as customer_name,c.phone as customer_phone,c.diet_preference,p.name as plan_name,k.name as kitchen_name FROM orders o LEFT JOIN customers c ON o.customer_id=c.id LEFT JOIN subscription_plans p ON o.plan_id=p.id LEFT JOIN kitchens k ON o.kitchen_id=k.id ORDER BY o.created_at DESC`));
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/orders', verifyToken, async (req, res) => {
    try {
        const { customer_id, plan_id, kitchen_id, start_date, paid_amount, notes, menu_start_slot } = req.body;
        if (!customer_id || !plan_id || !start_date)
            return res.status(400).json({ error: 'Customer, plan and start date required' });

        const plan = await db.one(`SELECT * FROM subscription_plans WHERE id=$1`, [plan_id]);
        if (!plan) return res.status(404).json({ error: 'Plan not found' });

        const customer = await db.one(`SELECT * FROM customers WHERE id=$1`, [customer_id]);
        if (!customer) return res.status(404).json({ error: 'Customer not found' });

        const vegCustomer = isVegCustomer(customer.diet_preference);

        // Parse delivery days for this plan (e.g. [1,3,6] = Mon,Wed,Sat)
        const deliveryDays = (plan.delivery_days || '1,2,3,4,5,6').split(',').map(Number);

        // Load ALL 24 menu slots if plan has a menu
        let allMenuSlots = [];
        if (plan.plan_menu_id) {
            allMenuSlots = await db.all(
                `SELECT * FROM plan_menu_slots WHERE plan_menu_id=$1 ORDER BY slot_number`,
                [plan.plan_menu_id]
            );
        }

        // Filter master slots to only those matching plan delivery days
        // A slot's weekday = ((slot_number-1) % 6) + 1
        const planSlots = allMenuSlots.filter(s => deliveryDays.includes(s.weekday));
        // planSlots is now ordered by slot_number, only matching weekdays
        // e.g. Mon/Wed/Sat plan: slots [1,3,6, 7,9,12, 13,15,18, 19,21,24]

        // startSlot: which index in planSlots to begin from (0-based)
        const startSlotNum = parseInt(menu_start_slot) || 1;
        // Find starting index in planSlots
        let startIdx = 0;
        if (planSlots.length > 0) {
            const found = planSlots.findIndex(s => s.slot_number >= startSlotNum);
            startIdx = found >= 0 ? found : 0;
        }

        const mealTypes = plan.meal_types ? plan.meal_types.split(',').map(s => s.trim()) : ['lunch'];
        const numDeliveries = plan.num_deliveries || 24;

        // Generate actual calendar dates for this plan's delivery days
        // We need numDeliveries dates that match the plan's delivery days (no Sundays ever)
        function genDatesForDays(startStr, count, allowedWeekdays) {
            const dates = [];
            const d = new Date(startStr + 'T12:00:00Z');
            while (dates.length < count) {
                const dow = d.getUTCDay(); // 0=Sun,1=Mon...6=Sat
                if (dow !== 0 && allowedWeekdays.includes(dow)) {
                    dates.push(d.toISOString().split('T')[0]);
                }
                d.setUTCDate(d.getUTCDate() + 1);
            }
            return dates;
        }

        const dates = genDatesForDays(start_date, numDeliveries, deliveryDays);
        const end_date = dates[dates.length - 1];

        // Calculate next_start_slot for renewal:
        // After using numDeliveries slots from planSlots starting at startIdx,
        // next order should start at (startIdx + numDeliveries) % planSlots.length
        let nextStartSlot = 1;
        if (planSlots.length > 0) {
            const nextIdx = (startIdx + numDeliveries) % planSlots.length;
            nextStartSlot = planSlots[nextIdx]?.slot_number || 1;
        }

        const ord = await db.one(
            `INSERT INTO orders (customer_id,plan_id,kitchen_id,start_date,end_date,menu_start_slot,total_amount,paid_amount,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
            [customer_id, plan_id, kitchen_id||null, start_date, end_date, startSlotNum, plan.price, paid_amount||0, notes||'']
        );

        // Insert deliveries — each date maps to the corresponding planSlot (cycling through)
        for (let i = 0; i < dates.length; i++) {
            const ds = dates[i];
            const slotIdx = (startIdx + i) % (planSlots.length || 1);
            const slot = planSlots.length > 0 ? planSlots[slotIdx] : null;

            for (const mt of mealTypes) {
                let mealItemId = null;
                if (slot) mealItemId = pickItemForCustomer(slot, customer.diet_preference);

                await db.query(
                    `INSERT INTO deliveries (order_id,customer_id,kitchen_id,delivery_date,meal_type,slot_number,meal_item_id,is_veg_customer,status,is_sunday_skip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',0)`,
                    [ord.id, customer_id, kitchen_id||null, ds, mt, slot?.slot_number||null, mealItemId, vegCustomer?1:0]
                );
            }
        }

        res.status(201).json({
            message: 'Order created', orderId: ord.id,
            deliveries: dates.length * mealTypes.length,
            vegCustomer, nextStartSlot,
            startSlot: startSlotNum, endDate: end_date
        });
    } catch(e) { console.error(e); res.status(400).json({ error: e.message }); }
});

// Renew order — creates a new order starting from next slot window
app.post('/api/admin/orders/renew/:id', verifyToken, async (req, res) => {
    try {
        const prevOrder = await db.one(`SELECT o.*,p.delivery_days,p.num_deliveries FROM orders o LEFT JOIN subscription_plans p ON o.plan_id=p.id WHERE o.id=$1`, [req.params.id]);
        if (!prevOrder) return res.status(404).json({ error: 'Order not found' });

        // Get all plan slots filtered by delivery_days
        const allMenuSlots = await db.all(`SELECT * FROM plan_menu_slots WHERE plan_menu_id=(SELECT plan_menu_id FROM subscription_plans WHERE id=$1) ORDER BY slot_number`, [prevOrder.plan_id]);
        const deliveryDays = (prevOrder.delivery_days || '1,2,3,4,5,6').split(',').map(Number);
        const planSlots = allMenuSlots.filter(s => deliveryDays.includes(s.weekday));

        if (!planSlots.length) return res.status(400).json({ error: 'Plan has no menu slots configured' });

        // Find where previous order started, calculate next start
        const prevStartIdx = planSlots.findIndex(s => s.slot_number >= (prevOrder.menu_start_slot || 1));
        const nextIdx = (Math.max(prevStartIdx,0) + (prevOrder.num_deliveries || 24)) % planSlots.length;
        const nextStartSlot = planSlots[nextIdx].slot_number;

        // New order starts day after previous end date
        const prevEnd = toDS(prevOrder.end_date);
        const newStart = nextWorkDay(prevEnd);

        // Delegate to main order creation
        req.body = {
            customer_id: prevOrder.customer_id,
            plan_id: prevOrder.plan_id,
            kitchen_id: prevOrder.kitchen_id,
            start_date: newStart,
            paid_amount: 0,
            notes: `Renewal of order #${prevOrder.id}`,
            menu_start_slot: nextStartSlot
        };

        // Re-run order creation logic by calling itself recursively via internal fetch isn't clean
        // Instead return the params so admin can confirm
        res.json({
            message: 'Renewal ready',
            suggestedStart: newStart,
            nextStartSlot,
            planId: prevOrder.plan_id,
            customerId: prevOrder.customer_id
        });
    } catch(e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/admin/orders/:id/status', verifyToken, async (req, res) => {
    try {
        const { order_status, payment_status, paid_amount } = req.body;
        await db.query(`UPDATE orders SET order_status=COALESCE($1,order_status),payment_status=COALESCE($2,payment_status),paid_amount=COALESCE($3,paid_amount) WHERE id=$4`,
            [order_status || null, payment_status || null, paid_amount || null, req.params.id]);
        res.json({ message: 'Updated' });
    } catch(e) { res.status(400).json({ error: e.message }); }
});

// ==================== ADMIN DELIVERIES ====================
app.get('/api/admin/deliveries', verifyToken, async (req, res) => {
    try {
        const { date, status, kitchen_id } = req.query;
        const params = [];
        let where = 'WHERE d.is_sunday_skip=0';
        if (date) { params.push(date); where += ` AND d.delivery_date=$${params.length}`; }
        if (status) { params.push(status); where += ` AND d.status=$${params.length}`; }
        if (kitchen_id) { params.push(parseInt(kitchen_id)); where += ` AND d.kitchen_id=$${params.length}`; }
        res.json(await db.all(`
            SELECT d.*,c.name as customer_name,c.phone as customer_phone,c.address as customer_address,
                c.diet_preference,k.name as kitchen_name,
                mi.name as meal_item_name,mc.name as category_name
            FROM deliveries d
            LEFT JOIN customers c ON d.customer_id=c.id
            LEFT JOIN kitchens k ON d.kitchen_id=k.id
            LEFT JOIN meal_items mi ON d.meal_item_id=mi.id
            LEFT JOIN meal_categories mc ON mi.category_id=mc.id
            ${where}
            ORDER BY d.delivery_date DESC,
                CASE d.meal_type WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'dinner' THEN 3 ELSE 4 END
        `, params));
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/admin/deliveries/:id/status', verifyToken, async (req, res) => {
    try {
        const { status, delivery_agent, notes } = req.body;
        const da = status === 'delivered' ? new Date().toISOString() : null;
        await db.query(`UPDATE deliveries SET status=$1,delivery_agent=COALESCE($2,delivery_agent),notes=COALESCE($3,notes),delivered_at=COALESCE($4,delivered_at) WHERE id=$5`,
            [status, delivery_agent || null, notes || null, da, req.params.id]);
        res.json({ message: 'Updated' });
    } catch(e) { res.status(400).json({ error: e.message }); }
});

// ==================== HEALTH ====================
app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ==================== STATIC FILES ====================
app.use(express.static(path.join(__dirname, 'public')));

app.get('/customer', (req, res) => {
    const f = path.join(__dirname, 'public', 'customer.html');
    if (fs.existsSync(f)) return res.sendFile(f);
    res.status(404).send('Not found');
});
app.get('/kitchen', (req, res) => {
    const f = path.join(__dirname, 'public', 'kitchen.html');
    if (fs.existsSync(f)) return res.sendFile(f);
    res.status(404).send('Kitchen portal not found');
});
app.get('/', (req, res) => {
    const f = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(f)) return res.sendFile(f);
    res.send('<h1>Salad Caffe</h1>');
});
app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    const f = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(f)) return res.sendFile(f);
    next();
});
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: err.message }); });

async function start() {
    try { await initDB(); } catch(e) { console.error('DB init failed:', e.message); }
    app.listen(PORT, () => {
        console.log(`✅ Port ${PORT}`);
        console.log(`📍 Admin:    http://localhost:${PORT}/`);
        console.log(`📍 Customer: http://localhost:${PORT}/customer`);
        console.log(`📍 Kitchen:  http://localhost:${PORT}/kitchen`);
    });
}
start();
module.exports = app;