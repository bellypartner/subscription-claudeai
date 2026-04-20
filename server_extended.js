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
    await db.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, phone TEXT, authority TEXT DEFAULT 'customer', status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`);
    await db.query(`CREATE TABLE IF NOT EXISTS meal_categories (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`);
    await db.query(`CREATE TABLE IF NOT EXISTS meal_items (id SERIAL PRIMARY KEY, name TEXT NOT NULL, category_id INTEGER NOT NULL REFERENCES meal_categories(id), veg_tag INTEGER DEFAULT 0, non_veg_tag INTEGER DEFAULT 0, eggetarian_tag INTEGER DEFAULT 0, vegan_tag INTEGER DEFAULT 0, description TEXT, ingredients TEXT, allergy_info TEXT, calories INTEGER, proteins DECIMAL(6,2), carbs DECIMAL(6,2), fiber DECIMAL(6,2), sugar DECIMAL(6,2), vitamins TEXT, mrp DECIMAL(10,2), image_base64 TEXT, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`);
    await db.query(`CREATE TABLE IF NOT EXISTS territories (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`);
    await db.query(`CREATE TABLE IF NOT EXISTS kitchens (id SERIAL PRIMARY KEY, name TEXT NOT NULL, territory_id INTEGER NOT NULL REFERENCES territories(id), address TEXT, capacity INTEGER, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`);
    await db.query(`CREATE TABLE IF NOT EXISTS subscription_plans (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, duration_days INTEGER, num_deliveries INTEGER, diet_type TEXT, price DECIMAL(10,2), meal_types TEXT, plan_menu_id INTEGER, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`)
    await db.query(`CREATE TABLE IF NOT EXISTS plan_menus (id SERIAL PRIMARY KEY, name TEXT NOT NULL, diet_type TEXT, meal_types TEXT, num_days INTEGER, days_of_week TEXT, categories TEXT, generated_slots JSONB, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`);
    await db.query(`CREATE TABLE IF NOT EXISTS customers (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT, address TEXT, alternate_address TEXT, territory_id INTEGER, allergies TEXT, health_notes TEXT, diet_preference TEXT DEFAULT 'both', status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`);
    await db.query(`CREATE TABLE IF NOT EXISTS orders (id SERIAL PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), plan_id INTEGER NOT NULL REFERENCES subscription_plans(id), kitchen_id INTEGER, start_date DATE NOT NULL, end_date DATE NOT NULL, total_amount DECIMAL(10,2), paid_amount DECIMAL(10,2) DEFAULT 0, payment_status TEXT DEFAULT 'pending', order_status TEXT DEFAULT 'active', pause_start DATE, pause_end DATE, extended_days INTEGER DEFAULT 0, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await db.query(`CREATE TABLE IF NOT EXISTS deliveries (id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), customer_id INTEGER NOT NULL REFERENCES customers(id), kitchen_id INTEGER, delivery_date DATE NOT NULL, meal_type TEXT NOT NULL, meal_item_id INTEGER REFERENCES meal_items(id), status TEXT DEFAULT 'pending', delivery_agent TEXT, delivered_at TIMESTAMPTZ, skipped_reason TEXT, is_sunday_skip INTEGER DEFAULT 0, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await db.query(`CREATE TABLE IF NOT EXISTS meal_skip_log (id SERIAL PRIMARY KEY, delivery_id INTEGER NOT NULL REFERENCES deliveries(id), customer_id INTEGER NOT NULL REFERENCES customers(id), reason TEXT, skipped_at TIMESTAMPTZ DEFAULT NOW())`);

    // Add new columns to existing tables (safe for existing DBs)
    try { await db.query(`ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS ingredients TEXT`); } catch(e){}
    try { await db.query(`ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS allergy_info TEXT`); } catch(e){}
    try { await db.query(`ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS proteins DECIMAL(6,2)`); } catch(e){}
    try { await db.query(`ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS carbs DECIMAL(6,2)`); } catch(e){}
    try { await db.query(`ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS fiber DECIMAL(6,2)`); } catch(e){}
    try { await db.query(`ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS sugar DECIMAL(6,2)`); } catch(e){}
    try { await db.query(`ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS vitamins TEXT`); } catch(e){}
    try { await db.query(`ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS image_base64 TEXT`); } catch(e){}
    try { await db.query(`ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS eggetarian_tag INTEGER DEFAULT 0`); } catch(e){}
    try { await db.query(`ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS vegan_tag INTEGER DEFAULT 0`); } catch(e){}
    try { await db.query(`ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS allergy_info TEXT`); } catch(e){}
    try { await db.query(`ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS proteins DECIMAL(6,2)`); } catch(e){}
    try { await db.query(`ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS carbs DECIMAL(6,2)`); } catch(e){}
    try { await db.query(`ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS fiber DECIMAL(6,2)`); } catch(e){}
    try { await db.query(`ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS sugar DECIMAL(6,2)`); } catch(e){}
    try { await db.query(`ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS vitamins TEXT`); } catch(e){}
    try { await db.query(`ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS image_base64 TEXT`); } catch(e){}
    try { await db.query(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS plan_menu_id INTEGER`); } catch(e){}
    try { await db.query(`CREATE TABLE IF NOT EXISTS plan_menus (id SERIAL PRIMARY KEY, name TEXT NOT NULL, diet_type TEXT, meal_types TEXT, num_days INTEGER, days_of_week TEXT, categories TEXT, generated_slots JSONB, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`); } catch(e){}

    const sa = await db.one(`SELECT id FROM users WHERE email=$1`, ['super@test.com']);
    if (!sa) {
        const h = bcrypt.hashSync('password123', 10);
        await db.query(`INSERT INTO users (name,email,password,authority) VALUES ($1,$2,$3,'super_admin')`, ['Super Admin', 'super@test.com', h]);
        console.log('✅ Super admin seeded');
    }
    const dc = await db.one(`SELECT id FROM users WHERE email=$1`, ['customer@test.com']);
    if (!dc) {
        const h = bcrypt.hashSync('customer123', 10);
        const u = await db.one(`INSERT INTO users (name,email,password,phone,authority) VALUES ($1,$2,$3,$4,'customer') RETURNING id`, ['Demo Customer', 'customer@test.com', h, '9876543210']);
        await db.query(`INSERT INTO customers (user_id,name,email,phone,address) VALUES ($1,$2,$3,$4,$5)`, [u.id, 'Demo Customer', 'customer@test.com', '9876543210', '123 Demo Street, Kochi']);
        console.log('✅ Demo customer seeded');
    }
    console.log('✅ Database ready');
}

function genDates(start, count) {
    const dates = [], d = new Date(start + 'T12:00:00Z');
    while (dates.length < count) { if (d.getUTCDay() !== 0) dates.push(d.toISOString().split('T')[0]); d.setUTCDate(d.getUTCDate() + 1); }
    return dates;
}
function nextWorkDay(ds) {
    const d = new Date(ds + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1);
    while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().split('T')[0];
}
function toDS(v) { return v instanceof Date ? v.toISOString().split('T')[0] : String(v).split('T')[0]; }

function verifyToken(req, res, next) {
    try { const t = req.headers['authorization']?.split(' ')[1]; if (!t) return res.status(403).json({ error: 'Token required' }); req.user = jwt.verify(t, JWT_SECRET); next(); }
    catch (e) { res.status(401).json({ error: 'Invalid token' }); }
}
function reqCust(req, res, next) { if (!['customer','super_admin','admin'].includes(req.user.authority)) return res.status(403).json({ error: 'Access denied' }); next(); }

// AUTH
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
        const user = await db.one(`SELECT * FROM users WHERE email=$1`, [email]);
        if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
        const token = jwt.sign({ id: user.id, email: user.email, authority: user.authority, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
        let customer = null;
        if (user.authority === 'customer') customer = await db.one(`SELECT * FROM customers WHERE user_id=$1`, [user.id]);
        res.json({ message: 'Login successful', token, user: { id: user.id, name: user.name, email: user.email, authority: user.authority, phone: user.phone }, customer, redirectTo: user.authority === 'customer' ? '/customer' : '/' });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Login failed' }); }
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password, phone, address } = req.body;
        if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });
        const h = bcrypt.hashSync(password, 10);
        const u = await db.one(`INSERT INTO users (name,email,password,phone,authority) VALUES ($1,$2,$3,$4,'customer') RETURNING id`, [name, email, h, phone || '']);
        await db.query(`INSERT INTO customers (user_id,name,email,phone,address) VALUES ($1,$2,$3,$4,$5)`, [u.id, name, email, phone || '', address || '']);
        const token = jwt.sign({ id: u.id, email, authority: 'customer', name }, JWT_SECRET, { expiresIn: '7d' });
        res.status(201).json({ message: 'Registered', token, redirectTo: '/customer' });
    } catch (e) {
        if (e.code === '23505') return res.status(400).json({ error: 'Email already registered' });
        res.status(500).json({ error: e.message });
    }
});

// CUSTOMER
app.get('/api/customer/profile', verifyToken, reqCust, async (req, res) => {
    try { const c = await db.one(`SELECT c.*,t.name as territory_name FROM customers c LEFT JOIN territories t ON c.territory_id=t.id WHERE c.user_id=$1`, [req.user.id]); if (!c) return res.status(404).json({ error: 'Not found' }); res.json(c); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/customer/profile', verifyToken, reqCust, async (req, res) => {
    try { const { name, phone, address, alternate_address, allergies, health_notes, diet_preference } = req.body; await db.query(`UPDATE customers SET name=$1,phone=$2,address=$3,alternate_address=$4,allergies=$5,health_notes=$6,diet_preference=$7 WHERE user_id=$8`, [name, phone, address, alternate_address, allergies, health_notes, diet_preference, req.user.id]); await db.query(`UPDATE users SET name=$1,phone=$2 WHERE id=$3`, [name, phone, req.user.id]); res.json({ message: 'Updated' }); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/customer/subscriptions', verifyToken, reqCust, async (req, res) => {
    try {
        const c = await db.one(`SELECT * FROM customers WHERE user_id=$1`, [req.user.id]);
        if (!c) return res.status(404).json({ error: 'Not found' });
        res.json(await db.all(`SELECT o.*,p.name as plan_name,p.diet_type,p.meal_types,p.duration_days,p.num_deliveries,k.name as kitchen_name,(SELECT COUNT(*)::int FROM deliveries WHERE order_id=o.id AND status='delivered') as delivered_count,(SELECT COUNT(*)::int FROM deliveries WHERE order_id=o.id AND status='pending') as pending_count,(SELECT COUNT(*)::int FROM deliveries WHERE order_id=o.id AND status='skipped' AND is_sunday_skip=0) as skipped_count FROM orders o LEFT JOIN subscription_plans p ON o.plan_id=p.id LEFT JOIN kitchens k ON o.kitchen_id=k.id WHERE o.customer_id=$1 ORDER BY o.created_at DESC`, [c.id]));
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/customer/calendar', verifyToken, reqCust, async (req, res) => {
    try {
        const c = await db.one(`SELECT * FROM customers WHERE user_id=$1`, [req.user.id]);
        const { month } = req.query;
        if (!month) return res.status(400).json({ error: 'month required (YYYY-MM)' });
        res.json(await db.all(`SELECT d.*,mi.name as meal_item_name,mi.calories,mi.veg_tag,mi.non_veg_tag,mc.name as category_name,p.name as plan_name,p.diet_type,k.name as kitchen_name FROM deliveries d LEFT JOIN meal_items mi ON d.meal_item_id=mi.id LEFT JOIN meal_categories mc ON mi.category_id=mc.id LEFT JOIN orders o ON d.order_id=o.id LEFT JOIN subscription_plans p ON o.plan_id=p.id LEFT JOIN kitchens k ON d.kitchen_id=k.id WHERE d.customer_id=$1 AND d.delivery_date>=($2||'-01')::date AND d.delivery_date<=($2||'-31')::date AND d.is_sunday_skip=0 ORDER BY d.delivery_date ASC,CASE d.meal_type WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'dinner' THEN 3 ELSE 4 END`, [c.id, month]));
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/customer/upcoming-meals', verifyToken, reqCust, async (req, res) => {
    try {
        const c = await db.one(`SELECT * FROM customers WHERE user_id=$1`, [req.user.id]);
        res.json(await db.all(`SELECT d.*,mi.name as meal_item_name,mi.calories,mi.veg_tag,mi.non_veg_tag,mc.name as category_name,p.name as plan_name,k.name as kitchen_name FROM deliveries d LEFT JOIN meal_items mi ON d.meal_item_id=mi.id LEFT JOIN meal_categories mc ON mi.category_id=mc.id LEFT JOIN orders o ON d.order_id=o.id LEFT JOIN subscription_plans p ON o.plan_id=p.id LEFT JOIN kitchens k ON d.kitchen_id=k.id WHERE d.customer_id=$1 AND d.delivery_date>=CURRENT_DATE AND d.delivery_date<=CURRENT_DATE+INTERVAL '7 days' AND d.is_sunday_skip=0 ORDER BY d.delivery_date ASC,CASE d.meal_type WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'dinner' THEN 3 ELSE 4 END`, [c.id]));
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/customer/delivery-history', verifyToken, reqCust, async (req, res) => {
    try {
        const c = await db.one(`SELECT * FROM customers WHERE user_id=$1`, [req.user.id]);
        res.json(await db.all(`SELECT d.*,mi.name as meal_item_name,mc.name as category_name,p.name as plan_name FROM deliveries d LEFT JOIN meal_items mi ON d.meal_item_id=mi.id LEFT JOIN meal_categories mc ON mi.category_id=mc.id LEFT JOIN orders o ON d.order_id=o.id LEFT JOIN subscription_plans p ON o.plan_id=p.id WHERE d.customer_id=$1 AND d.delivery_date<CURRENT_DATE AND d.is_sunday_skip=0 ORDER BY d.delivery_date DESC LIMIT 60`, [c.id]));
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/customer/skip-meal/:id', verifyToken, reqCust, async (req, res) => {
    try {
        const c = await db.one(`SELECT * FROM customers WHERE user_id=$1`, [req.user.id]);
        const d = await db.one(`SELECT * FROM deliveries WHERE id=$1 AND customer_id=$2`, [req.params.id, c.id]);
        if (!d) return res.status(404).json({ error: 'Delivery not found' });
        if (d.status !== 'pending') return res.status(400).json({ error: 'Cannot skip — already ' + d.status });
        const dl = new Date(toDS(d.delivery_date) + 'T22:00:00'); dl.setDate(dl.getDate() - 1);
        if (new Date() > dl) return res.status(400).json({ error: 'Skip deadline passed (10 PM previous night)' });
        const { reason } = req.body;
        await db.query(`UPDATE deliveries SET status='skipped',skipped_reason=$1 WHERE id=$2`, [reason || 'Customer request', d.id]);
        await db.query(`INSERT INTO meal_skip_log (delivery_id,customer_id,reason) VALUES ($1,$2,$3)`, [d.id, c.id, reason || 'Customer request']);
        const order = await db.one(`SELECT * FROM orders WHERE id=$1`, [d.order_id]);
        if (order && order.extended_days < 45) {
            const ne = nextWorkDay(toDS(order.end_date));
            await db.query(`UPDATE orders SET end_date=$1,extended_days=extended_days+1 WHERE id=$2`, [ne, order.id]);
        }
        res.json({ message: `${d.meal_type} on ${toDS(d.delivery_date)} skipped. Extended by 1 working day. No refund issued.` });
    } catch (e) { res.status(500).json({ error: e.message }); }
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
        if (days < 1 || days > 30) return res.status(400).json({ error: 'Pause must be 1–30 days' });
        let ext = 0; const cur = new Date(pause_start + 'T12:00:00Z'); const ed = new Date(pause_end + 'T12:00:00Z');
        while (cur <= ed) { if (cur.getUTCDay() !== 0) ext++; cur.setUTCDate(cur.getUTCDate() + 1); }
        await db.query(`UPDATE deliveries SET status='skipped',skipped_reason='Subscription paused' WHERE order_id=$1 AND delivery_date>=$2 AND delivery_date<=$3 AND status='pending' AND is_sunday_skip=0`, [order.id, pause_start, pause_end]);
        let ne = new Date(toDS(order.end_date) + 'T12:00:00Z'); let added = 0;
        while (added < ext) { ne.setUTCDate(ne.getUTCDate() + 1); if (ne.getUTCDay() !== 0) added++; }
        const newEnd = ne.toISOString().split('T')[0];
        await db.query(`UPDATE orders SET order_status='paused',pause_start=$1,pause_end=$2,end_date=$3 WHERE id=$4`, [pause_start, pause_end, newEnd, order.id]);
        res.json({ message: `Paused ${pause_start} to ${pause_end}. End date extended to ${newEnd}. No refund for paused days.` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/customer/cancel-subscription/:id', verifyToken, reqCust, async (req, res) => {
    try {
        const c = await db.one(`SELECT * FROM customers WHERE user_id=$1`, [req.user.id]);
        const order = await db.one(`SELECT * FROM orders WHERE id=$1 AND customer_id=$2`, [req.params.id, c.id]);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        if (['cancelled','completed'].includes(order.order_status)) return res.status(400).json({ error: 'Already ' + order.order_status });
        await db.query(`UPDATE orders SET order_status='cancelled' WHERE id=$1`, [order.id]);
        await db.query(`UPDATE deliveries SET status='skipped',skipped_reason='Cancelled by customer' WHERE order_id=$1 AND status='pending'`, [order.id]);
        res.json({ message: 'Cancelled. No refund will be issued as per our cancellation policy.' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/customer/plans', async (req, res) => { try { res.json(await db.all(`SELECT * FROM subscription_plans WHERE status='active' ORDER BY price ASC`)); } catch (e) { res.status(500).json({ error: e.message }); } });

// ADMIN STATS
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
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ADMIN CATEGORIES
app.get('/api/admin/categories', verifyToken, async (req, res) => { try { res.json(await db.all(`SELECT * FROM meal_categories WHERE status='active' ORDER BY name`)); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/admin/categories', verifyToken, async (req, res) => { try { const{name,description}=req.body; if(!name) return res.status(400).json({error:'Name required'}); const r=await db.one(`INSERT INTO meal_categories (name,description) VALUES ($1,$2) RETURNING id`,[name,description||'']); res.status(201).json({message:'Created',categoryId:r.id}); } catch(e){res.status(400).json({error:e.message});} });
app.delete('/api/admin/categories/:id', verifyToken, async (req, res) => { try { await db.query(`UPDATE meal_categories SET status='inactive' WHERE id=$1`,[req.params.id]); res.json({message:'Deleted'}); } catch(e){res.status(500).json({error:e.message});} });

// ADMIN MEALS
app.get('/api/admin/meal-items', verifyToken, async (req, res) => { try { res.json(await db.all(`SELECT m.*,c.name as category_name FROM meal_items m LEFT JOIN meal_categories c ON m.category_id=c.id WHERE m.status='active' ORDER BY c.name,m.name`)); } catch(e){res.status(500).json({error:e.message});} });
app.post('/api/admin/meal-items', verifyToken, async (req, res) => { try { const{name,category_id,veg_tag,non_veg_tag,eggetarian_tag,vegan_tag,description,ingredients,allergy_info,calories,proteins,carbs,fiber,sugar,vitamins,mrp,image_base64}=req.body; if(!name||!category_id) return res.status(400).json({error:'Name and category required'}); const r=await db.one(`INSERT INTO meal_items (name,category_id,veg_tag,non_veg_tag,eggetarian_tag,vegan_tag,description,ingredients,allergy_info,calories,proteins,carbs,fiber,sugar,vitamins,mrp,image_base64) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,[name,category_id,veg_tag?1:0,non_veg_tag?1:0,eggetarian_tag?1:0,vegan_tag?1:0,description||'',ingredients||'',allergy_info||'',calories||0,proteins||null,carbs||null,fiber||null,sugar||null,vitamins||'',mrp||0,image_base64||null]); res.status(201).json({message:'Created',mealItemId:r.id}); } catch(e){res.status(400).json({error:e.message});} });
app.delete('/api/admin/meal-items/:id', verifyToken, async (req, res) => { try { await db.query(`UPDATE meal_items SET status='inactive' WHERE id=$1`,[req.params.id]); res.json({message:'Deleted'}); } catch(e){res.status(500).json({error:e.message});} });

// ADMIN TERRITORIES
app.get('/api/admin/territories', verifyToken, async (req, res) => { try { res.json(await db.all(`SELECT * FROM territories WHERE status='active' ORDER BY name`)); } catch(e){res.status(500).json({error:e.message});} });
app.post('/api/admin/territories', verifyToken, async (req, res) => { try { const{name,description}=req.body; if(!name) return res.status(400).json({error:'Name required'}); const r=await db.one(`INSERT INTO territories (name,description) VALUES ($1,$2) RETURNING id`,[name,description||'']); res.status(201).json({message:'Created',territoryId:r.id}); } catch(e){res.status(400).json({error:e.message});} });

// ADMIN KITCHENS
app.get('/api/admin/kitchens', verifyToken, async (req, res) => { try { res.json(await db.all(`SELECT k.*,t.name as territory_name FROM kitchens k LEFT JOIN territories t ON k.territory_id=t.id WHERE k.status='active' ORDER BY k.name`)); } catch(e){res.status(500).json({error:e.message});} });
app.post('/api/admin/kitchens', verifyToken, async (req, res) => { try { const{name,territory_id,address,capacity}=req.body; if(!name||!territory_id) return res.status(400).json({error:'Name and territory required'}); const r=await db.one(`INSERT INTO kitchens (name,territory_id,address,capacity) VALUES ($1,$2,$3,$4) RETURNING id`,[name,territory_id,address||'',capacity||100]); res.status(201).json({message:'Created',kitchenId:r.id}); } catch(e){res.status(400).json({error:e.message});} });

// ADMIN PLANS
app.get('/api/admin/subscription-plans', verifyToken, async (req, res) => { try { res.json(await db.all(`SELECT sp.*,bc.name as breakfast_category_name,lc.name as lunch_category_name,dc.name as dinner_category_name FROM subscription_plans sp LEFT JOIN meal_categories bc ON sp.breakfast_category_id=bc.id LEFT JOIN meal_categories lc ON sp.lunch_category_id=lc.id LEFT JOIN meal_categories dc ON sp.dinner_category_id=dc.id WHERE sp.status='active' ORDER BY sp.price ASC`)); } catch(e){res.status(500).json({error:e.message});} });
app.post('/api/admin/subscription-plans', verifyToken, async (req, res) => {
    try {
        const{name,duration_days,num_deliveries,diet_type,price,meal_types,breakfast_category_id,lunch_category_id,dinner_category_id}=req.body;
        if(!name||!duration_days||!num_deliveries||!diet_type||!price||!meal_types) return res.status(400).json({error:'Missing required fields'});
        const r=await db.one(`INSERT INTO subscription_plans (name,duration_days,num_deliveries,diet_type,price,meal_types,breakfast_category_id,lunch_category_id,dinner_category_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[name,duration_days,num_deliveries,diet_type,price,meal_types,breakfast_category_id||null,lunch_category_id||null,dinner_category_id||null]);
        res.status(201).json({message:'Created',planId:r.id});
    } catch(e){res.status(400).json({error:e.message});}
});
app.delete('/api/admin/subscription-plans/:id', verifyToken, async (req, res) => { try { await db.query(`UPDATE subscription_plans SET status='inactive' WHERE id=$1`,[req.params.id]); res.json({message:'Deleted'}); } catch(e){res.status(500).json({error:e.message});} });

// ADMIN CUSTOMERS
app.get('/api/admin/customers', verifyToken, async (req, res) => { try { res.json(await db.all(`SELECT c.*,t.name as territory_name,COUNT(o.id)::int as total_orders FROM customers c LEFT JOIN territories t ON c.territory_id=t.id LEFT JOIN orders o ON o.customer_id=c.id WHERE c.status='active' GROUP BY c.id,t.name ORDER BY c.created_at DESC`)); } catch(e){res.status(500).json({error:e.message});} });
app.post('/api/admin/customers', verifyToken, async (req, res) => { try { const{name,email,phone,address,territory_id}=req.body; if(!name||!email) return res.status(400).json({error:'Name and email required'}); const r=await db.one(`INSERT INTO customers (name,email,phone,address,territory_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,[name,email,phone||'',address||'',territory_id||null]); res.status(201).json({message:'Created',customerId:r.id}); } catch(e){res.status(400).json({error:e.message});} });
app.delete('/api/admin/customers/:id', verifyToken, async (req, res) => { try { await db.query(`UPDATE customers SET status='inactive' WHERE id=$1`,[req.params.id]); res.json({message:'Deleted'}); } catch(e){res.status(500).json({error:e.message});} });

// ADMIN ORDERS
app.get('/api/admin/orders', verifyToken, async (req, res) => { try { res.json(await db.all(`SELECT o.*,c.name as customer_name,c.phone as customer_phone,p.name as plan_name,k.name as kitchen_name FROM orders o LEFT JOIN customers c ON o.customer_id=c.id LEFT JOIN subscription_plans p ON o.plan_id=p.id LEFT JOIN kitchens k ON o.kitchen_id=k.id ORDER BY o.created_at DESC`)); } catch(e){res.status(500).json({error:e.message});} });
app.post('/api/admin/orders', verifyToken, async (req, res) => {
    try {
        const{customer_id,plan_id,kitchen_id,start_date,paid_amount,notes}=req.body;
        if(!customer_id||!plan_id||!start_date) return res.status(400).json({error:'Customer, plan and start date required'});
        const plan=await db.one(`SELECT * FROM subscription_plans WHERE id=$1`,[plan_id]);
        if(!plan) return res.status(404).json({error:'Plan not found'});
        const mts=plan.meal_types?plan.meal_types.split(',').map(s=>s.trim()):['lunch'];
        const dates=genDates(start_date,Math.ceil(plan.num_deliveries/mts.length));
        const end_date=dates[dates.length-1];
        const ord=await db.one(`INSERT INTO orders (customer_id,plan_id,kitchen_id,start_date,end_date,total_amount,paid_amount,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[customer_id,plan_id,kitchen_id||null,start_date,end_date,plan.price,paid_amount||0,notes||'']);
        const catMap={breakfast:plan.breakfast_category_id,lunch:plan.lunch_category_id,dinner:plan.dinner_category_id};
        const defItem={};
        for(const mt of mts){ if(catMap[mt]){const it=await db.one(`SELECT id FROM meal_items WHERE category_id=$1 AND status='active' LIMIT 1`,[catMap[mt]]);defItem[mt]=it?it.id:null;} }
        let slots=0;
        for(const ds of dates){ for(const mt of mts){ if(slots>=plan.num_deliveries) break; await db.query(`INSERT INTO deliveries (order_id,customer_id,kitchen_id,delivery_date,meal_type,meal_item_id,status,is_sunday_skip) VALUES ($1,$2,$3,$4,$5,$6,'pending',0)`,[ord.id,customer_id,kitchen_id||null,ds,mt,defItem[mt]||null]); slots++; } }
        res.status(201).json({message:'Order created',orderId:ord.id,slots});
    } catch(e){console.error(e);res.status(400).json({error:e.message});}
});
app.put('/api/admin/orders/:id/status', verifyToken, async (req, res) => { try { const{order_status,payment_status,paid_amount}=req.body; await db.query(`UPDATE orders SET order_status=COALESCE($1,order_status),payment_status=COALESCE($2,payment_status),paid_amount=COALESCE($3,paid_amount) WHERE id=$4`,[order_status||null,payment_status||null,paid_amount||null,req.params.id]); res.json({message:'Updated'}); } catch(e){res.status(400).json({error:e.message});} });

// ADMIN DELIVERIES
app.get('/api/admin/deliveries', verifyToken, async (req, res) => {
    try {
        const{date,status}=req.query; const params=[]; let where='WHERE d.is_sunday_skip=0';
        if(date){params.push(date);where+=` AND d.delivery_date=$${params.length}`;}
        if(status){params.push(status);where+=` AND d.status=$${params.length}`;}
        res.json(await db.all(`SELECT d.*,c.name as customer_name,c.phone as customer_phone,c.address as customer_address,k.name as kitchen_name,mi.name as meal_item_name,mc.name as category_name FROM deliveries d LEFT JOIN customers c ON d.customer_id=c.id LEFT JOIN kitchens k ON d.kitchen_id=k.id LEFT JOIN meal_items mi ON d.meal_item_id=mi.id LEFT JOIN meal_categories mc ON mi.category_id=mc.id ${where} ORDER BY d.delivery_date DESC,CASE d.meal_type WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'dinner' THEN 3 ELSE 4 END`,params));
    } catch(e){res.status(500).json({error:e.message});}
});
app.put('/api/admin/deliveries/:id/status', verifyToken, async (req, res) => { try { const{status,delivery_agent,notes}=req.body; const da=status==='delivered'?new Date().toISOString():null; await db.query(`UPDATE deliveries SET status=$1,delivery_agent=COALESCE($2,delivery_agent),notes=COALESCE($3,notes),delivered_at=COALESCE($4,delivered_at) WHERE id=$5`,[status,delivery_agent||null,notes||null,da,req.params.id]); res.json({message:'Updated'}); } catch(e){res.status(400).json({error:e.message});} });
app.put('/api/admin/deliveries/:id/assign-meal', verifyToken, async (req, res) => { try { await db.query(`UPDATE deliveries SET meal_item_id=$1 WHERE id=$2`,[req.body.meal_item_id,req.params.id]); res.json({message:'Meal assigned'}); } catch(e){res.status(400).json({error:e.message});} });
app.post('/api/admin/deliveries/bulk-assign', verifyToken, async (req, res) => { try { const{meal_type,meal_item_id,date_from,date_to}=req.body; if(!meal_type||!meal_item_id||!date_from||!date_to) return res.status(400).json({error:'All fields required'}); const r=await db.query(`UPDATE deliveries SET meal_item_id=$1 WHERE meal_type=$2 AND delivery_date>=$3 AND delivery_date<=$4 AND is_sunday_skip=0`,[meal_item_id,meal_type,date_from,date_to]); res.json({message:`Updated ${r.rowCount} slots`}); } catch(e){res.status(400).json({error:e.message});} });

// Auto-generate plan menu
app.post('/api/admin/plan-menu/generate', verifyToken, async (req, res) => {
    try {
        const { plan_id, diet_type, meal_types, categories, num_days, days_of_week } = req.body;
        if (!diet_type || !meal_types || !categories || !num_days) return res.status(400).json({ error: 'Missing required fields' });
        const mts = meal_types.split(',').map(s=>s.trim());
        const catIds = categories; // {breakfast: id, lunch: id, dinner: id}
        const allowedDays = days_of_week ? days_of_week.map(Number) : [1,2,3,4,5,6]; // 0=Sun excluded always

        // Build menu: for each day slot, pick a meal item from the right category
        // rotating through all available items to avoid repetition
        const itemCache = {};
        for (const mt of mts) {
            const catIds_arr = catIds[mt]; // now an array
            if (!catIds_arr || !catIds_arr.length) continue;
            const placeholders = catIds_arr.map((_, i) => `$${i+1}`).join(',');
            let q = `SELECT id,name,calories,veg_tag,non_veg_tag,eggetarian_tag,vegan_tag FROM meal_items WHERE category_id IN (${placeholders}) AND status='active'`;
            const params = catIds_arr;
            if (diet_type === 'pure_veg') { q += ' AND veg_tag=1'; }
            else if (diet_type === 'non_veg') { q += ' AND non_veg_tag=1'; }
            else if (diet_type === 'vegan') { q += ' AND vegan_tag=1'; }
            else if (diet_type === 'eggetarian') { q += ' AND eggetarian_tag=1'; }
            // mixed = all items, alternated by day in loop below
            itemCache[mt] = await db.all(q, params);
        }

        const menu = []; // [{day:1, date_offset:0, meal_type:'lunch', meal_item_id:3, meal_item_name:'...'}]
        let dayCount = 0;
        let offset = 0;
        const idxMap = {};
        mts.forEach(m => idxMap[m] = 0);

        // Mixed alternating types: day 1=veg, day 2=egg, day 3=nonveg, repeat
        const mixedTypes = ['pure_veg', 'eggetarian', 'non_veg'];
        const mixedFields = { pure_veg: 'veg_tag', eggetarian: 'eggetarian_tag', non_veg: 'non_veg_tag' };

        while (dayCount < num_days) {
            const jsDow = (offset) % 7;
            if (allowedDays.includes(jsDow === 0 ? 0 : jsDow) && jsDow !== 0) {
                for (const mt of mts) {
                    let items = itemCache[mt] || [];
                    // For mixed plans, filter by alternating diet type for this day
                    if (diet_type === 'mixed' && items.length) {
                        const dayDiet = mixedTypes[dayCount % 3];
                        const field = mixedFields[dayDiet];
                        const filtered = items.filter(i => i[field] === 1);
                        if (filtered.length) items = filtered;
                    }
                    if (!items.length) { menu.push({ day: dayCount+1, offset, meal_type: mt, meal_item_id: null, meal_item_name: 'No items in category' }); continue; }
                    const item = items[idxMap[mt] % items.length];
                    idxMap[mt]++;
                    menu.push({ day: dayCount+1, offset, meal_type: mt, meal_item_id: item.id, meal_item_name: item.name, calories: item.calories });
                }
                dayCount++;
            }
            offset++;
            if (offset > num_days * 3) break;
        }

        res.json({ menu, total_slots: menu.length });
    } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});


// ===== PLAN MENUS =====
app.get('/api/admin/plan-menus', verifyToken, async (req, res) => {
    try { res.json(await db.all(`SELECT * FROM plan_menus WHERE status='active' ORDER BY created_at DESC`)); }
    catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/plan-menus/save', verifyToken, async (req, res) => {
    try {
        const { name, diet_type, meal_types, num_days, days_of_week, categories, generated_slots } = req.body;
        if (!name || !generated_slots) return res.status(400).json({ error: 'Name and generated slots required' });
        const r = await db.one(
            `INSERT INTO plan_menus (name,diet_type,meal_types,num_days,days_of_week,categories,generated_slots) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [name, diet_type, meal_types, num_days, JSON.stringify(days_of_week), JSON.stringify(categories), JSON.stringify(generated_slots)]
        );
        res.status(201).json({ message: 'Plan menu saved', menuId: r.id });
    } catch(e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/admin/plan-menus/:id', verifyToken, async (req, res) => {
    try { await db.query(`UPDATE plan_menus SET status='inactive' WHERE id=$1`, [req.params.id]); res.json({ message: 'Deleted' }); }
    catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.use(express.static(path.join(__dirname, 'public')));
app.get('/customer', (req, res) => { const f=path.join(__dirname,'public','customer.html'); if(fs.existsSync(f)) return res.sendFile(f); res.status(404).send('Not found'); });
app.get('/', (req, res) => { const f=path.join(__dirname,'public','index.html'); if(fs.existsSync(f)) return res.sendFile(f); res.send('<h1>Salad Caffe</h1>'); });
app.use((req, res, next) => { if(req.path.startsWith('/api')) return next(); const f=path.join(__dirname,'public','index.html'); if(fs.existsSync(f)) return res.sendFile(f); next(); });
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: err.message }); });

async function start() {
    try { await initDB(); } catch(e) { console.error('DB init failed:', e.message); }
    app.listen(PORT, () => { console.log(`✅ Port ${PORT} | Admin: / | Customer: /customer`); });
}
start();
module.exports = app;