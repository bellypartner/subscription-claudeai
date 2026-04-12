const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your_secret_key';

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Database
const db = new Database('./salad_caffe.db');
db.pragma('journal_mode = WAL');

console.log('✓ Connected to database');
initializeDatabase();

// Initialize Database Tables
function initializeDatabase() {
    try {
        // Users Table
        db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                phone TEXT,
                address TEXT,
                googleMapLocation TEXT,
                userType TEXT NOT NULL,
                authority TEXT NOT NULL,
                region TEXT,
                kitchenId INTEGER,
                dietaryPreferences TEXT,
                allergies TEXT,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Kitchens Table
        db.exec(`
            CREATE TABLE IF NOT EXISTS kitchens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                region TEXT NOT NULL,
                address TEXT,
                managerId INTEGER,
                capacity INTEGER,
                operatingHours TEXT,
                status TEXT DEFAULT 'active',
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Plans Table
        db.exec(`
            CREATE TABLE IF NOT EXISTS plans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                mealsPerWeek INTEGER NOT NULL,
                price DECIMAL(10, 2) NOT NULL,
                description TEXT,
                isActive INTEGER DEFAULT 1,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Meals Table
        db.exec(`
            CREATE TABLE IF NOT EXISTS meals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                mealType TEXT NOT NULL,
                price DECIMAL(10, 2) NOT NULL,
                calories INTEGER,
                description TEXT,
                ingredients TEXT,
                allergies TEXT,
                specialInstructions TEXT,
                kitchenId INTEGER,
                availableQuantity INTEGER NOT NULL,
                status TEXT DEFAULT 'active',
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Subscriptions Table
        db.exec(`
            CREATE TABLE IF NOT EXISTS subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customerId INTEGER NOT NULL,
                planId INTEGER NOT NULL,
                status TEXT DEFAULT 'active',
                startDate DATETIME DEFAULT CURRENT_TIMESTAMP,
                endDate DATETIME,
                nextRenewalDate DATETIME,
                pausedUntil DATETIME,
                cancellationReason TEXT,
                mealTiming TEXT,
                specialInstructions TEXT,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(customerId) REFERENCES users(id),
                FOREIGN KEY(planId) REFERENCES plans(id)
            )
        `);

        // Orders Table
        db.exec(`
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subscriptionId INTEGER,
                customerId INTEGER NOT NULL,
                mealId INTEGER NOT NULL,
                deliveryDate DATETIME NOT NULL,
                mealType TEXT,
                status TEXT DEFAULT 'scheduled',
                orderAmount DECIMAL(10, 2) NOT NULL,
                deliveryNotes TEXT,
                specialInstructions TEXT,
                kitchenId INTEGER,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(subscriptionId) REFERENCES subscriptions(id),
                FOREIGN KEY(customerId) REFERENCES users(id),
                FOREIGN KEY(mealId) REFERENCES meals(id)
            )
        `);

        // Delivery Assignments Table
        db.exec(`
            CREATE TABLE IF NOT EXISTS delivery_assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                orderId INTEGER NOT NULL,
                deliveryPersonId INTEGER NOT NULL,
                kitchenId INTEGER NOT NULL,
                assignedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                scheduledDeliveryTime TEXT,
                status TEXT DEFAULT 'assigned',
                actualDeliveryTime DATETIME,
                notes TEXT,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(orderId) REFERENCES orders(id),
                FOREIGN KEY(deliveryPersonId) REFERENCES users(id)
            )
        `);

        // Deliveries Table
        db.exec(`
            CREATE TABLE IF NOT EXISTS deliveries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                orderId INTEGER NOT NULL,
                deliveryPersonId INTEGER NOT NULL,
                customerId INTEGER NOT NULL,
                status TEXT DEFAULT 'pending',
                assignedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                pickupTime DATETIME,
                deliveryTime DATETIME,
                customerAddress TEXT,
                googleMapLocation TEXT,
                notes TEXT,
                proofImage TEXT,
                confirmationCode TEXT,
                confirmedByExecutive INTEGER,
                confirmedAt DATETIME,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(orderId) REFERENCES orders(id),
                FOREIGN KEY(deliveryPersonId) REFERENCES users(id),
                FOREIGN KEY(customerId) REFERENCES users(id)
            )
        `);

        // Skipped Meals Table
        db.exec(`
            CREATE TABLE IF NOT EXISTS skipped_meals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subscriptionId INTEGER NOT NULL,
                mealDate DATETIME NOT NULL,
                reason TEXT,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(subscriptionId) REFERENCES subscriptions(id)
            )
        `);

        // Cancellation Requests Table
        db.exec(`
            CREATE TABLE IF NOT EXISTS cancellation_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subscriptionId INTEGER NOT NULL,
                customerId INTEGER NOT NULL,
                reason TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                requestedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                approvedAt DATETIME,
                approvedBy INTEGER,
                FOREIGN KEY(subscriptionId) REFERENCES subscriptions(id),
                FOREIGN KEY(customerId) REFERENCES users(id),
                FOREIGN KEY(approvedBy) REFERENCES users(id)
            )
        `);

        // Renewal Schedules Table
        db.exec(`
            CREATE TABLE IF NOT EXISTS renewal_schedules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subscriptionId INTEGER NOT NULL,
                renewalDate DATETIME NOT NULL,
                amount DECIMAL(10, 2) NOT NULL,
                paymentStatus TEXT DEFAULT 'pending',
                paymentDate DATETIME,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(subscriptionId) REFERENCES subscriptions(id)
            )
        `);

        console.log('✓ Database tables initialized');
        insertSampleData();
    } catch (err) {
        console.error('Database init error:', err);
    }
}

// Insert Sample Data
function insertSampleData() {
    try {
        db.exec(`INSERT OR IGNORE INTO plans (id, name, mealsPerWeek, price, description) VALUES 
            (1, 'Basic', 3, 199, '3 healthy meals per week'),
            (2, 'Premium', 5, 349, '5 healthy meals per week'),
            (3, 'Elite', 7, 499, '7 healthy meals per week')`
        );

        db.exec(`INSERT OR IGNORE INTO kitchens (id, name, region, address, capacity) VALUES 
            (1, 'Central Kitchen', 'Thiruvananthapuram', '123 Main Street', 100),
            (2, 'North Kitchen', 'Kochi', '456 Oak Avenue', 80)`
        );

        db.exec(`INSERT OR IGNORE INTO meals (id, name, type, mealType, price, calories, description, kitchenId, availableQuantity) VALUES 
            (1, 'Grilled Chicken Salad', 'Non-Vegetarian', 'lunch', 249, 450, 'Fresh grilled chicken with mixed greens', 1, 45),
            (2, 'Vegan Buddha Bowl', 'Vegan', 'lunch', 279, 520, 'Chickpeas, quinoa, and fresh vegetables', 1, 28),
            (3, 'Mediterranean Bowl', 'Vegetarian', 'dinner', 259, 480, 'Feta cheese, olives, and fresh herbs', 1, 30),
            (4, 'Protein Boost Breakfast', 'Non-Vegetarian', 'breakfast', 199, 380, 'Eggs, turkey, whole wheat toast', 1, 40),
            (5, 'Green Smoothie Bowl', 'Vegan', 'breakfast', 179, 350, 'Spinach, banana, and granola', 2, 50)`
        );

        console.log('✓ Sample data inserted');
    } catch (err) {
        console.log('Sample data already exists');
    }
}

// ==================== AUTHENTICATION ====================

// Register
app.post('/api/auth/register', (req, res) => {
    try {
        const { name, email, password, userType = 'customer', authority = 'customer' } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const hashedPassword = bcrypt.hashSync(password, 10);

        const stmt = db.prepare(
            `INSERT INTO users (name, email, password, userType, authority) VALUES (?, ?, ?, ?, ?)`
        );
        const result = stmt.run(name, email, hashedPassword, userType, authority);

        const token = jwt.sign({ id: result.lastInsertRowid, email, authority }, JWT_SECRET, { expiresIn: '7d' });
        res.status(201).json({
            message: 'User registered successfully',
            token,
            user: { id: result.lastInsertRowid, name, email, authority }
        });
    } catch (err) {
        res.status(400).json({ error: 'Email already exists or invalid input' });
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
                phone: user.phone,
                address: user.address
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

// ==================== SUBSCRIPTIONS ====================

// Create Subscription
app.post('/api/admin-executive/subscriptions', verifyToken, (req, res) => {
    try {
        const { customerId, planId, mealTiming, specialInstructions } = req.body;

        if (!customerId || !planId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const startDate = new Date().toISOString();
        const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        const stmt = db.prepare(
            `INSERT INTO subscriptions (customerId, planId, startDate, endDate, nextRenewalDate, mealTiming, specialInstructions)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        const result = stmt.run(customerId, planId, startDate, endDate, endDate, mealTiming, specialInstructions);

        res.status(201).json({ message: 'Subscription created successfully', subscriptionId: result.lastInsertRowid });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create subscription' });
    }
});

// Get Subscriptions
app.get('/api/subscriptions', verifyToken, (req, res) => {
    try {
        const stmt = db.prepare(
            `SELECT s.*, p.name as planName, p.mealsPerWeek, p.price FROM subscriptions s 
             JOIN plans p ON s.planId = p.id WHERE s.customerId = ?`
        );
        const rows = stmt.all(req.user.id);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch subscriptions' });
    }
});

// ==================== CUSTOMER ====================

// Get Profile
app.get('/api/customer/profile', verifyToken, (req, res) => {
    try {
        const stmt = db.prepare(
            `SELECT id, name, email, phone, address, googleMapLocation, allergies, dietaryPreferences FROM users WHERE id = ?`
        );
        const user = stmt.get(req.user.id);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

// Update Profile
app.put('/api/customer/profile', verifyToken, (req, res) => {
    try {
        const { name, phone, address, googleMapLocation, allergies, dietaryPreferences } = req.body;

        const stmt = db.prepare(
            `UPDATE users SET name = ?, phone = ?, address = ?, googleMapLocation = ?, allergies = ?, dietaryPreferences = ? WHERE id = ?`
        );
        stmt.run(name, phone, address, googleMapLocation, allergies, dietaryPreferences, req.user.id);

        res.json({ message: 'Profile updated successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// ==================== SUPER ADMIN ====================

// Create User
app.post('/api/super-admin/users', verifyToken, (req, res) => {
    try {
        const { name, email, password, authority, region, kitchenId } = req.body;

        if (!name || !email || !password || !authority) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const hashedPassword = bcrypt.hashSync(password, 10);

        const stmt = db.prepare(
            `INSERT INTO users (name, email, password, userType, authority, region, kitchenId) 
             VALUES (?, ?, ?, 'staff', ?, ?, ?)`
        );
        const result = stmt.run(name, email, hashedPassword, authority, region, kitchenId || null);

        res.status(201).json({ message: 'User created successfully', userId: result.lastInsertRowid });
    } catch (err) {
        res.status(400).json({ error: 'Failed to create user' });
    }
});

// Get All Users
app.get('/api/super-admin/users', verifyToken, (req, res) => {
    try {
        const stmt = db.prepare(
            `SELECT id, name, email, authority, region, kitchenId, createdAt FROM users`
        );
        const rows = stmt.all();
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// Create Kitchen
app.post('/api/super-admin/kitchens', verifyToken, (req, res) => {
    try {
        const { name, region, address, capacity } = req.body;

        if (!name || !region) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const stmt = db.prepare(
            `INSERT INTO kitchens (name, region, address, capacity) VALUES (?, ?, ?, ?)`
        );
        const result = stmt.run(name, region, address, capacity);

        res.status(201).json({ message: 'Kitchen created successfully', kitchenId: result.lastInsertRowid });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create kitchen' });
    }
});

// ==================== HEALTH CHECK ====================

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// ==================== SERVE HTML ====================

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
