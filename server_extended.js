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

const db = new Database(process.env.DATABASE_PATH || './salad_caffe.db');
db.pragma('journal_mode = WAL');

initializeDatabase();

function initializeDatabase() {
    db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, phone TEXT, authority TEXT DEFAULT 'customer', status TEXT DEFAULT 'active', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.exec(`CREATE TABLE IF NOT EXISTS meal_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT, status TEXT DEFAULT 'active', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.exec(`CREATE TABLE IF NOT EXISTS meal_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category_id INTEGER NOT NULL, veg_tag INTEGER DEFAULT 0, non_veg_tag INTEGER DEFAULT 0, description TEXT, calories INTEGER, weight TEXT, mrp DECIMAL(10,2), prep_time_minutes INTEGER, status TEXT DEFAULT 'active', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(category_id) REFERENCES meal_categories(id))`);
    db.exec(`CREATE TABLE IF NOT EXISTS territories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT, status TEXT DEFAULT 'active', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.exec(`CREATE TABLE IF NOT EXISTS kitchens (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, territory_id INTEGER NOT NULL, address TEXT, capacity INTEGER, status TEXT DEFAULT 'active', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(territory_id) REFERENCES territories(id))`);
    db.exec(`CREATE TABLE IF NOT EXISTS subscription_plans (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, duration_days INTEGER, num_deliveries INTEGER, diet_type TEXT, price DECIMAL(10,2), meal_types TEXT, breakfast_category_id INTEGER, lunch_category_id INTEGER, dinner_category_id INTEGER, status TEXT DEFAULT 'active', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.exec(`CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT, address TEXT, alternate_address TEXT, territory_id INTEGER, allergies TEXT, health_notes TEXT, diet_preference TEXT DEFAULT 'both', status TEXT DEFAULT 'active', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id))`);
    db.exec(`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, plan_id INTEGER NOT NULL, kitchen_id INTEGER, start_date DATE NOT NULL, end_date DATE NOT NULL, total_amount DECIMAL(10,2), paid_amount DECIMAL(10,2) DEFAULT 0, payment_status TEXT DEFAULT 'pending', order_status TEXT DEFAULT 'active', pause_start DATE, pause_end DATE, extended_days INTEGER DEFAULT 0, notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(plan_id) REFERENCES subscription_plans(id))`);
    db.exec(`CREATE TABLE IF NOT EXISTS deliveries (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, customer_id INTEGER NOT NULL, kitchen_id INTEGER, delivery_date DATE NOT NULL, meal_type TEXT NOT NULL, meal_item_id INTEGER, status TEXT DEFAULT 'pending', delivery_agent TEXT, delivered_at DATETIME, skipped_reason TEXT, is_sunday_skip INTEGER DEFAULT 0, notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(order_id) REFERENCES orders(id), FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(meal_item_id) REFERENCES meal_items(id))`);
    db.exec(`CREATE TABLE IF NOT EXISTS meal_skip_log (id INTEGER PRIMARY KEY AUTOINCREMENT, delivery_id INTEGER NOT NULL, customer_id INTEGER NOT NULL, reason TEXT, skipped_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

    try { const h=bcrypt.hashSync('password123',10); db.prepare(`INSERT OR IGNORE INTO users (name,email,password,authority) VALUES (?,?,?,'super_admin')`).run('Super Admin','super@test.com',h); } catch(e){}
    try {
        const h=bcrypt.hashSync('customer123',10);
        const ur=db.prepare(`INSERT OR IGNORE INTO users (name,email,password,phone,authority) VALUES (?,?,?,?,'customer')`).run('Demo Customer','customer@test.com',h,'9876543210');
        if(ur.lastInsertRowid) db.prepare(`INSERT OR IGNORE INTO customers (user_id,name,email,phone,address) VALUES (?,?,?,?,?)`).run(ur.lastInsertRowid,'Demo Customer','customer@test.com','9876543210','123 Demo Street, Kochi');
    } catch(e){}
    console.log('✅ Database ready');
}

function isSunday(d) { return new Date(d+'T12:00:00').getDay()===0; }

function generateDeliveryDates(startStr, count) {
    const dates=[]; const d=new Date(startStr+'T12:00:00');
    while(dates.length<count){ if(d.getDay()!==0) dates.push(d.toISOString().split('T')[0]); d.setDate(d.getDate()+1); }
    return dates;
}

function nextWorkingDay(dateStr) {
    const d=new Date(dateStr+'T12:00:00'); d.setDate(d.getDate()+1);
    while(d.getDay()===0) d.setDate(d.getDate()+1);
    return d.toISOString().split('T')[0];
}

function verifyToken(req,res,next) {
    try { const t=req.headers['authorization']?.split(' ')[1]; if(!t) return res.status(403).json({error:'Token required'}); req.user=jwt.verify(t,JWT_SECRET); next(); }
    catch(e){ res.status(401).json({error:'Invalid token'}); }
}
function requireCustomer(req,res,next){ if(!['customer','super_admin','admin'].includes(req.user.authority)) return res.status(403).json({error:'Access denied'}); next(); }

// ===== AUTH =====
app.post('/api/auth/login',(req,res)=>{
    try {
        const {email,password}=req.body;
        if(!email||!password) return res.status(400).json({error:'Email and password required'});
        const user=db.prepare(`SELECT * FROM users WHERE email=?`).get(email);
        if(!user||!bcrypt.compareSync(password,user.password)) return res.status(401).json({error:'Invalid credentials'});
        const token=jwt.sign({id:user.id,email:user.email,authority:user.authority,name:user.name},JWT_SECRET,{expiresIn:'7d'});
        let customer=null;
        if(user.authority==='customer') customer=db.prepare(`SELECT * FROM customers WHERE user_id=?`).get(user.id);
        res.json({message:'Login successful',token,user:{id:user.id,name:user.name,email:user.email,authority:user.authority,phone:user.phone},customer,redirectTo:user.authority==='customer'?'/customer':'/'});
    } catch(e){ res.status(500).json({error:'Login failed'}); }
});

app.post('/api/auth/register',(req,res)=>{
    try {
        const {name,email,password,phone,address}=req.body;
        if(!name||!email||!password) return res.status(400).json({error:'Name, email and password required'});
        const h=bcrypt.hashSync(password,10);
        const ur=db.prepare(`INSERT INTO users (name,email,password,phone,authority) VALUES (?,?,?,?,'customer')`).run(name,email,h,phone||'');
        db.prepare(`INSERT INTO customers (user_id,name,email,phone,address) VALUES (?,?,?,?,?)`).run(ur.lastInsertRowid,name,email,phone||'',address||'');
        const token=jwt.sign({id:ur.lastInsertRowid,email,authority:'customer',name},JWT_SECRET,{expiresIn:'7d'});
        res.status(201).json({message:'Registered',token,redirectTo:'/customer'});
    } catch(e){ if(e.message.includes('UNIQUE')) return res.status(400).json({error:'Email already registered'}); res.status(500).json({error:e.message}); }
});

// ===== CUSTOMER APIs =====
app.get('/api/customer/profile',verifyToken,requireCustomer,(req,res)=>{
    try { const c=db.prepare(`SELECT c.*,t.name as territory_name FROM customers c LEFT JOIN territories t ON c.territory_id=t.id WHERE c.user_id=?`).get(req.user.id); if(!c) return res.status(404).json({error:'Not found'}); res.json(c); }
    catch(e){ res.status(500).json({error:e.message}); }
});
app.put('/api/customer/profile',verifyToken,requireCustomer,(req,res)=>{
    try { const {name,phone,address,alternate_address,allergies,health_notes,diet_preference}=req.body; db.prepare(`UPDATE customers SET name=?,phone=?,address=?,alternate_address=?,allergies=?,health_notes=?,diet_preference=? WHERE user_id=?`).run(name,phone,address,alternate_address,allergies,health_notes,diet_preference,req.user.id); db.prepare(`UPDATE users SET name=?,phone=? WHERE id=?`).run(name,phone,req.user.id); res.json({message:'Updated'}); }
    catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/customer/subscriptions',verifyToken,requireCustomer,(req,res)=>{
    try {
        const c=db.prepare(`SELECT * FROM customers WHERE user_id=?`).get(req.user.id);
        if(!c) return res.status(404).json({error:'Not found'});
        const orders=db.prepare(`SELECT o.*,p.name as plan_name,p.diet_type,p.meal_types,p.duration_days,p.num_deliveries,k.name as kitchen_name,(SELECT COUNT(*) FROM deliveries WHERE order_id=o.id AND status='delivered') as delivered_count,(SELECT COUNT(*) FROM deliveries WHERE order_id=o.id AND status='pending') as pending_count,(SELECT COUNT(*) FROM deliveries WHERE order_id=o.id AND status='skipped' AND is_sunday_skip=0) as skipped_count FROM orders o LEFT JOIN subscription_plans p ON o.plan_id=p.id LEFT JOIN kitchens k ON o.kitchen_id=k.id WHERE o.customer_id=? ORDER BY o.created_at DESC`).all(c.id);
        res.json(orders);
    } catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/customer/calendar',verifyToken,requireCustomer,(req,res)=>{
    try {
        const c=db.prepare(`SELECT * FROM customers WHERE user_id=?`).get(req.user.id);
        const {month}=req.query; if(!month) return res.status(400).json({error:'month required (YYYY-MM)'});
        const deliveries=db.prepare(`SELECT d.*,mi.name as meal_item_name,mi.calories,mi.veg_tag,mi.non_veg_tag,mc.name as category_name,p.name as plan_name,p.diet_type,k.name as kitchen_name FROM deliveries d LEFT JOIN meal_items mi ON d.meal_item_id=mi.id LEFT JOIN meal_categories mc ON mi.category_id=mc.id LEFT JOIN orders o ON d.order_id=o.id LEFT JOIN subscription_plans p ON o.plan_id=p.id LEFT JOIN kitchens k ON d.kitchen_id=k.id WHERE d.customer_id=? AND d.delivery_date>=? AND d.delivery_date<=? AND d.is_sunday_skip=0 ORDER BY d.delivery_date ASC,CASE d.meal_type WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'dinner' THEN 3 ELSE 4 END`).all(c.id,`${month}-01`,`${month}-31`);
        res.json(deliveries);
    } catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/customer/upcoming-meals',verifyToken,requireCustomer,(req,res)=>{
    try {
        const c=db.prepare(`SELECT * FROM customers WHERE user_id=?`).get(req.user.id);
        const meals=db.prepare(`SELECT d.*,mi.name as meal_item_name,mi.calories,mi.veg_tag,mi.non_veg_tag,mc.name as category_name,p.name as plan_name,k.name as kitchen_name FROM deliveries d LEFT JOIN meal_items mi ON d.meal_item_id=mi.id LEFT JOIN meal_categories mc ON mi.category_id=mc.id LEFT JOIN orders o ON d.order_id=o.id LEFT JOIN subscription_plans p ON o.plan_id=p.id LEFT JOIN kitchens k ON d.kitchen_id=k.id WHERE d.customer_id=? AND d.delivery_date>=date('now') AND d.delivery_date<=date('now','+7 days') AND d.is_sunday_skip=0 ORDER BY d.delivery_date ASC,CASE d.meal_type WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'dinner' THEN 3 ELSE 4 END`).all(c.id);
        res.json(meals);
    } catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/customer/delivery-history',verifyToken,requireCustomer,(req,res)=>{
    try {
        const c=db.prepare(`SELECT * FROM customers WHERE user_id=?`).get(req.user.id);
        const h=db.prepare(`SELECT d.*,mi.name as meal_item_name,mc.name as category_name,p.name as plan_name FROM deliveries d LEFT JOIN meal_items mi ON d.meal_item_id=mi.id LEFT JOIN meal_categories mc ON mi.category_id=mc.id LEFT JOIN orders o ON d.order_id=o.id LEFT JOIN subscription_plans p ON o.plan_id=p.id WHERE d.customer_id=? AND d.delivery_date<date('now') AND d.is_sunday_skip=0 ORDER BY d.delivery_date DESC LIMIT 60`).all(c.id);
        res.json(h);
    } catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/customer/skip-meal/:id',verifyToken,requireCustomer,(req,res)=>{
    try {
        const c=db.prepare(`SELECT * FROM customers WHERE user_id=?`).get(req.user.id);
        const d=db.prepare(`SELECT * FROM deliveries WHERE id=? AND customer_id=?`).get(req.params.id,c.id);
        if(!d) return res.status(404).json({error:'Delivery not found'});
        if(d.status!=='pending') return res.status(400).json({error:'Cannot skip — already '+d.status});
        const deadline=new Date(d.delivery_date+'T22:00:00'); deadline.setDate(deadline.getDate()-1);
        if(new Date()>deadline) return res.status(400).json({error:'Skip deadline passed (10:00 PM previous night)'});
        const {reason}=req.body;
        db.prepare(`UPDATE deliveries SET status='skipped',skipped_reason=? WHERE id=?`).run(reason||'Customer request',d.id);
        db.prepare(`INSERT INTO meal_skip_log (delivery_id,customer_id,reason) VALUES (?,?,?)`).run(d.id,c.id,reason||'Customer request');
        const order=db.prepare(`SELECT * FROM orders WHERE id=?`).get(d.order_id);
        if(order&&order.extended_days<45){
            const ne=nextWorkingDay(order.end_date);
            db.prepare(`UPDATE orders SET end_date=?,extended_days=extended_days+1 WHERE id=?`).run(ne,order.id);
        }
        res.json({message:`${d.meal_type} on ${d.delivery_date} skipped. Subscription extended by 1 working day. No refund issued.`});
    } catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/customer/pause-subscription/:id',verifyToken,requireCustomer,(req,res)=>{
    try {
        const c=db.prepare(`SELECT * FROM customers WHERE user_id=?`).get(req.user.id);
        const order=db.prepare(`SELECT * FROM orders WHERE id=? AND customer_id=?`).get(req.params.id,c.id);
        if(!order) return res.status(404).json({error:'Order not found'});
        if(order.order_status!=='active') return res.status(400).json({error:'Order not active'});
        const {pause_start,pause_end}=req.body;
        if(!pause_start||!pause_end) return res.status(400).json({error:'Dates required'});
        const days=Math.ceil((new Date(pause_end)-new Date(pause_start))/86400000);
        if(days<1||days>30) return res.status(400).json({error:'Pause must be 1-30 days'});
        let ext=0; const cur=new Date(pause_start+'T12:00:00'); const ed=new Date(pause_end+'T12:00:00');
        while(cur<=ed){ if(cur.getDay()!==0) ext++; cur.setDate(cur.getDate()+1); }
        db.prepare(`UPDATE deliveries SET status='skipped',skipped_reason='Subscription paused' WHERE order_id=? AND delivery_date>=? AND delivery_date<=? AND status='pending' AND is_sunday_skip=0`).run(order.id,pause_start,pause_end);
        let ne=new Date(order.end_date+'T12:00:00'); let added=0;
        while(added<ext){ ne.setDate(ne.getDate()+1); if(ne.getDay()!==0) added++; }
        const newEnd=ne.toISOString().split('T')[0];
        db.prepare(`UPDATE orders SET order_status='paused',pause_start=?,pause_end=?,end_date=? WHERE id=?`).run(pause_start,pause_end,newEnd,order.id);
        res.json({message:`Paused ${pause_start} to ${pause_end}. End date extended to ${newEnd}. No refund for paused days.`});
    } catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/customer/cancel-subscription/:id',verifyToken,requireCustomer,(req,res)=>{
    try {
        const c=db.prepare(`SELECT * FROM customers WHERE user_id=?`).get(req.user.id);
        const order=db.prepare(`SELECT * FROM orders WHERE id=? AND customer_id=?`).get(req.params.id,c.id);
        if(!order) return res.status(404).json({error:'Order not found'});
        if(['cancelled','completed'].includes(order.order_status)) return res.status(400).json({error:'Already '+order.order_status});
        db.prepare(`UPDATE orders SET order_status='cancelled' WHERE id=?`).run(order.id);
        db.prepare(`UPDATE deliveries SET status='skipped',skipped_reason='Cancelled by customer' WHERE order_id=? AND status='pending'`).run(order.id);
        res.json({message:'Subscription cancelled. No refund will be issued as per our cancellation policy.'});
    } catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/customer/plans',(req,res)=>{ try { res.json(db.prepare(`SELECT * FROM subscription_plans WHERE status='active' ORDER BY price ASC`).all()); } catch(e){ res.status(500).json({error:e.message}); } });

// ===== ADMIN STATS =====
app.get('/api/admin/stats',verifyToken,(req,res)=>{
    try {
        res.json({
            totalCustomers:db.prepare(`SELECT COUNT(*) as c FROM customers WHERE status='active'`).get().c,
            totalOrders:db.prepare(`SELECT COUNT(*) as c FROM orders`).get().c,
            activeOrders:db.prepare(`SELECT COUNT(*) as c FROM orders WHERE order_status='active'`).get().c,
            totalRevenue:db.prepare(`SELECT COALESCE(SUM(paid_amount),0) as t FROM orders`).get().t,
            pendingDeliveries:db.prepare(`SELECT COUNT(*) as c FROM deliveries WHERE status='pending' AND delivery_date=date('now') AND is_sunday_skip=0`).get().c,
            todayDeliveries:db.prepare(`SELECT COUNT(*) as c FROM deliveries WHERE delivery_date=date('now') AND is_sunday_skip=0`).get().c,
            totalMeals:db.prepare(`SELECT COUNT(*) as c FROM meal_items WHERE status='active'`).get().c,
            totalPlans:db.prepare(`SELECT COUNT(*) as c FROM subscription_plans WHERE status='active'`).get().c,
            recentOrders:db.prepare(`SELECT o.*,c.name as customer_name,p.name as plan_name FROM orders o LEFT JOIN customers c ON o.customer_id=c.id LEFT JOIN subscription_plans p ON o.plan_id=p.id ORDER BY o.created_at DESC LIMIT 5`).all()
        });
    } catch(e){ res.status(500).json({error:e.message}); }
});

// ===== ADMIN CATEGORIES =====
app.get('/api/admin/categories',verifyToken,(req,res)=>{ try{res.json(db.prepare(`SELECT * FROM meal_categories WHERE status='active' ORDER BY name`).all()||[]);}catch(e){res.status(500).json({error:e.message});} });
app.post('/api/admin/categories',verifyToken,(req,res)=>{ try{const{name,description}=req.body;if(!name)return res.status(400).json({error:'Name required'});const r=db.prepare(`INSERT INTO meal_categories (name,description) VALUES (?,?)`).run(name,description||'');res.status(201).json({message:'Created',categoryId:r.lastInsertRowid});}catch(e){res.status(400).json({error:e.message});} });
app.delete('/api/admin/categories/:id',verifyToken,(req,res)=>{ try{db.prepare(`UPDATE meal_categories SET status='inactive' WHERE id=?`).run(req.params.id);res.json({message:'Deleted'});}catch(e){res.status(500).json({error:e.message});} });

// ===== ADMIN MEAL ITEMS =====
app.get('/api/admin/meal-items',verifyToken,(req,res)=>{ try{res.json(db.prepare(`SELECT m.*,c.name as category_name FROM meal_items m LEFT JOIN meal_categories c ON m.category_id=c.id WHERE m.status='active' ORDER BY c.name,m.name`).all()||[]);}catch(e){res.status(500).json({error:e.message});} });
app.post('/api/admin/meal-items',verifyToken,(req,res)=>{ try{const{name,category_id,veg_tag,non_veg_tag,description,calories,weight,mrp,prep_time_minutes}=req.body;if(!name||!category_id)return res.status(400).json({error:'Name and category required'});const r=db.prepare(`INSERT INTO meal_items (name,category_id,veg_tag,non_veg_tag,description,calories,weight,mrp,prep_time_minutes) VALUES (?,?,?,?,?,?,?,?,?)`).run(name,category_id,veg_tag?1:0,non_veg_tag?1:0,description||'',calories||0,weight||'',mrp||0,prep_time_minutes||0);res.status(201).json({message:'Created',mealItemId:r.lastInsertRowid});}catch(e){res.status(400).json({error:e.message});} });
app.delete('/api/admin/meal-items/:id',verifyToken,(req,res)=>{ try{db.prepare(`UPDATE meal_items SET status='inactive' WHERE id=?`).run(req.params.id);res.json({message:'Deleted'});}catch(e){res.status(500).json({error:e.message});} });

// ===== ADMIN TERRITORIES =====
app.get('/api/admin/territories',verifyToken,(req,res)=>{ try{res.json(db.prepare(`SELECT * FROM territories WHERE status='active' ORDER BY name`).all()||[]);}catch(e){res.status(500).json({error:e.message});} });
app.post('/api/admin/territories',verifyToken,(req,res)=>{ try{const{name,description}=req.body;if(!name)return res.status(400).json({error:'Name required'});const r=db.prepare(`INSERT INTO territories (name,description) VALUES (?,?)`).run(name,description||'');res.status(201).json({message:'Created',territoryId:r.lastInsertRowid});}catch(e){res.status(400).json({error:e.message});} });

// ===== ADMIN KITCHENS =====
app.get('/api/admin/kitchens',verifyToken,(req,res)=>{ try{res.json(db.prepare(`SELECT k.*,t.name as territory_name FROM kitchens k LEFT JOIN territories t ON k.territory_id=t.id WHERE k.status='active' ORDER BY k.name`).all()||[]);}catch(e){res.status(500).json({error:e.message});} });
app.post('/api/admin/kitchens',verifyToken,(req,res)=>{ try{const{name,territory_id,address,capacity}=req.body;if(!name||!territory_id)return res.status(400).json({error:'Name and territory required'});const r=db.prepare(`INSERT INTO kitchens (name,territory_id,address,capacity) VALUES (?,?,?,?)`).run(name,territory_id,address||'',capacity||100);res.status(201).json({message:'Created',kitchenId:r.lastInsertRowid});}catch(e){res.status(400).json({error:e.message});} });

// ===== ADMIN PLANS =====
app.get('/api/admin/subscription-plans',verifyToken,(req,res)=>{ try{res.json(db.prepare(`SELECT sp.*,bc.name as breakfast_category_name,lc.name as lunch_category_name,dc.name as dinner_category_name FROM subscription_plans sp LEFT JOIN meal_categories bc ON sp.breakfast_category_id=bc.id LEFT JOIN meal_categories lc ON sp.lunch_category_id=lc.id LEFT JOIN meal_categories dc ON sp.dinner_category_id=dc.id WHERE sp.status='active' ORDER BY sp.price ASC`).all()||[]);}catch(e){res.status(500).json({error:e.message});} });
app.post('/api/admin/subscription-plans',verifyToken,(req,res)=>{
    try{
        const{name,duration_days,num_deliveries,diet_type,price,meal_types,breakfast_category_id,lunch_category_id,dinner_category_id}=req.body;
        if(!name||!duration_days||!num_deliveries||!diet_type||!price||!meal_types) return res.status(400).json({error:'Missing required fields'});
        const r=db.prepare(`INSERT INTO subscription_plans (name,duration_days,num_deliveries,diet_type,price,meal_types,breakfast_category_id,lunch_category_id,dinner_category_id) VALUES (?,?,?,?,?,?,?,?,?)`).run(name,duration_days,num_deliveries,diet_type,price,meal_types,breakfast_category_id||null,lunch_category_id||null,dinner_category_id||null);
        res.status(201).json({message:'Created',planId:r.lastInsertRowid});
    }catch(e){res.status(400).json({error:e.message});}
});
app.delete('/api/admin/subscription-plans/:id',verifyToken,(req,res)=>{ try{db.prepare(`UPDATE subscription_plans SET status='inactive' WHERE id=?`).run(req.params.id);res.json({message:'Deleted'});}catch(e){res.status(500).json({error:e.message});} });

// ===== ADMIN CUSTOMERS =====
app.get('/api/admin/customers',verifyToken,(req,res)=>{ try{res.json(db.prepare(`SELECT c.*,t.name as territory_name,COUNT(o.id) as total_orders FROM customers c LEFT JOIN territories t ON c.territory_id=t.id LEFT JOIN orders o ON o.customer_id=c.id WHERE c.status='active' GROUP BY c.id ORDER BY c.created_at DESC`).all()||[]);}catch(e){res.status(500).json({error:e.message});} });
app.post('/api/admin/customers',verifyToken,(req,res)=>{ try{const{name,email,phone,address,territory_id}=req.body;if(!name||!email)return res.status(400).json({error:'Name and email required'});const r=db.prepare(`INSERT INTO customers (name,email,phone,address,territory_id) VALUES (?,?,?,?,?)`).run(name,email,phone||'',address||'',territory_id||null);res.status(201).json({message:'Created',customerId:r.lastInsertRowid});}catch(e){res.status(400).json({error:e.message});} });
app.delete('/api/admin/customers/:id',verifyToken,(req,res)=>{ try{db.prepare(`UPDATE customers SET status='inactive' WHERE id=?`).run(req.params.id);res.json({message:'Deleted'});}catch(e){res.status(500).json({error:e.message});} });

// ===== ADMIN ORDERS =====
app.get('/api/admin/orders',verifyToken,(req,res)=>{ try{res.json(db.prepare(`SELECT o.*,c.name as customer_name,c.phone as customer_phone,p.name as plan_name,k.name as kitchen_name FROM orders o LEFT JOIN customers c ON o.customer_id=c.id LEFT JOIN subscription_plans p ON o.plan_id=p.id LEFT JOIN kitchens k ON o.kitchen_id=k.id ORDER BY o.created_at DESC`).all()||[]);}catch(e){res.status(500).json({error:e.message});} });
app.post('/api/admin/orders',verifyToken,(req,res)=>{
    try{
        const{customer_id,plan_id,kitchen_id,start_date,paid_amount,notes}=req.body;
        if(!customer_id||!plan_id||!start_date) return res.status(400).json({error:'Customer, plan and start date required'});
        const plan=db.prepare(`SELECT * FROM subscription_plans WHERE id=?`).get(plan_id);
        if(!plan) return res.status(404).json({error:'Plan not found'});
        const mealTypes=plan.meal_types?plan.meal_types.split(',').map(s=>s.trim()):['lunch'];
        const slotsPerDay=mealTypes.length;
        const daysNeeded=Math.ceil(plan.num_deliveries/slotsPerDay);
        const dates=generateDeliveryDates(start_date,daysNeeded);
        const end_date=dates[dates.length-1];
        const r=db.prepare(`INSERT INTO orders (customer_id,plan_id,kitchen_id,start_date,end_date,total_amount,paid_amount,notes) VALUES (?,?,?,?,?,?,?,?)`).run(customer_id,plan_id,kitchen_id||null,start_date,end_date,plan.price,paid_amount||0,notes||'');
        const catMap={breakfast:plan.breakfast_category_id,lunch:plan.lunch_category_id,dinner:plan.dinner_category_id};
        const defItem={};
        for(const mt of mealTypes){ if(catMap[mt]){const it=db.prepare(`SELECT id FROM meal_items WHERE category_id=? AND status='active' LIMIT 1`).get(catMap[mt]);defItem[mt]=it?it.id:null;} }
        let slots=0;
        for(const ds of dates){
            for(const mt of mealTypes){
                if(slots>=plan.num_deliveries) break;
                db.prepare(`INSERT INTO deliveries (order_id,customer_id,kitchen_id,delivery_date,meal_type,meal_item_id,status,is_sunday_skip) VALUES (?,?,?,?,?,?,'pending',0)`).run(r.lastInsertRowid,customer_id,kitchen_id||null,ds,mt,defItem[mt]||null);
                slots++;
            }
        }
        res.status(201).json({message:'Order created',orderId:r.lastInsertRowid,slots});
    }catch(e){ console.error(e); res.status(400).json({error:e.message}); }
});
app.put('/api/admin/orders/:id/status',verifyToken,(req,res)=>{ try{const{order_status,payment_status,paid_amount}=req.body;db.prepare(`UPDATE orders SET order_status=COALESCE(?,order_status),payment_status=COALESCE(?,payment_status),paid_amount=COALESCE(?,paid_amount) WHERE id=?`).run(order_status||null,payment_status||null,paid_amount||null,req.params.id);res.json({message:'Updated'});}catch(e){res.status(400).json({error:e.message});} });

// ===== ADMIN DELIVERIES =====
app.get('/api/admin/deliveries',verifyToken,(req,res)=>{
    try{
        const{date,status}=req.query;
        let q=`SELECT d.*,c.name as customer_name,c.phone as customer_phone,c.address as customer_address,k.name as kitchen_name,mi.name as meal_item_name,mc.name as category_name FROM deliveries d LEFT JOIN customers c ON d.customer_id=c.id LEFT JOIN kitchens k ON d.kitchen_id=k.id LEFT JOIN meal_items mi ON d.meal_item_id=mi.id LEFT JOIN meal_categories mc ON mi.category_id=mc.id WHERE d.is_sunday_skip=0`;
        const p=[];
        if(date){q+=' AND d.delivery_date=?';p.push(date);}
        if(status){q+=' AND d.status=?';p.push(status);}
        q+=' ORDER BY d.delivery_date DESC,CASE d.meal_type WHEN "breakfast" THEN 1 WHEN "lunch" THEN 2 WHEN "dinner" THEN 3 ELSE 4 END';
        res.json(db.prepare(q).all(...p)||[]);
    }catch(e){res.status(500).json({error:e.message});}
});
app.put('/api/admin/deliveries/:id/status',verifyToken,(req,res)=>{ try{const{status,delivery_agent,notes}=req.body;const da=status==='delivered'?new Date().toISOString():null;db.prepare(`UPDATE deliveries SET status=?,delivery_agent=COALESCE(?,delivery_agent),notes=COALESCE(?,notes),delivered_at=COALESCE(?,delivered_at) WHERE id=?`).run(status,delivery_agent||null,notes||null,da,req.params.id);res.json({message:'Updated'});}catch(e){res.status(400).json({error:e.message});} });
app.put('/api/admin/deliveries/:id/assign-meal',verifyToken,(req,res)=>{ try{const{meal_item_id}=req.body;db.prepare(`UPDATE deliveries SET meal_item_id=? WHERE id=?`).run(meal_item_id,req.params.id);res.json({message:'Meal assigned'});}catch(e){res.status(400).json({error:e.message});} });
app.post('/api/admin/deliveries/bulk-assign',verifyToken,(req,res)=>{
    try{
        const{meal_type,meal_item_id,date_from,date_to}=req.body;
        if(!meal_type||!meal_item_id||!date_from||!date_to) return res.status(400).json({error:'All fields required'});
        const r=db.prepare(`UPDATE deliveries SET meal_item_id=? WHERE meal_type=? AND delivery_date>=? AND delivery_date<=? AND is_sunday_skip=0`).run(meal_item_id,meal_type,date_from,date_to);
        res.json({message:`Updated ${r.changes} slots`});
    }catch(e){res.status(400).json({error:e.message});}
});

app.get('/api/health',(req,res)=>res.json({status:'ok',ts:new Date().toISOString()}));

app.use(express.static(path.join(__dirname,'public')));
app.get('/customer',(req,res)=>{ const f=path.join(__dirname,'public','customer.html'); if(fs.existsSync(f)) return res.sendFile(f); res.status(404).send('Not found'); });
app.get('/',(req,res)=>{ const f=path.join(__dirname,'public','index.html'); if(fs.existsSync(f)) return res.sendFile(f); res.send('<h1>Salad Caffe</h1>'); });
app.use((req,res,next)=>{ if(req.path.startsWith('/api')) return next(); const f=path.join(__dirname,'public','index.html'); if(fs.existsSync(f)) return res.sendFile(f); next(); });
app.use((err,req,res,next)=>{ console.error(err); res.status(500).json({error:err.message}); });

app.listen(PORT,()=>{ console.log(`✅ Port ${PORT} | Admin: / | Customer: /customer`); });
module.exports=app;
