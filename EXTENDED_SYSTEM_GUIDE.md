# Salad Caffe - Extended System with New Authorities
## Complete PWA Implementation Guide

---

## 🎯 New Authorities & Roles

Your extended system now includes 6 distinct user authorities:

### 1. **Kitchen Manager** 👨‍⚙️
**Responsibilities:**
- View all kitchen operations for their region
- Schedule deliveries (date, time, meal type)
- Update delivery schedules
- Assign deliveries to delivery personnel
- Confirm deliveries if delivery executives don't mark
- Monitor prep progress
- Manage staff schedules

**Dashboard Features:**
- Today's orders count
- Pending deliveries
- Completed deliveries
- Delivery schedule management
- Staff assignment

---

### 2. **Kitchen Staff** 👨‍🍳
**Responsibilities:**
- View orders to prepare by meal type (breakfast, lunch, dinner)
- See customer allergies and special instructions
- Mark meals as prepared
- Perform quality checks
- Add preparation notes

**Dashboard Features:**
- Filter orders by meal type
- Customer details (name, address, allergies)
- Special meal instructions
- Prep completion tracking
- Quality check approval
- Time tracking

---

### 3. **Admin Executive** 📋
**Responsibilities:**
- Create new subscriptions for customers
- Manage subscription details
- Confirm deliveries if delivery person doesn't mark
- Handle subscription renewals
- Customer service functions

**Dashboard Features:**
- Create subscription button
- Pending delivery confirmations
- Customer subscription management
- Renewal tracking

---

### 4. **Organization Head** 🏢
**Responsibilities:**
- View complete organizational operations
- Monitor all regions
- See all staff members
- Track organization-wide progress
- Revenue and performance metrics
- Multi-kitchen management

**Dashboard Features:**
- Total customers
- Active subscriptions
- Total kitchens
- Total delivery persons
- Regional performance breakdown
- Monthly progress tracking
- Staff list view

---

### 5. **Super Admin** 👑
**Responsibilities:**
- Complete control over entire system
- Create and manage all users
- Create and manage kitchens
- Delete users if needed
- Monitor all operations
- System configuration

**Dashboard Features:**
- User management (create, delete, view all)
- Kitchen creation
- Complete system oversight
- Staff management across all regions

---

### 6. **Customer** 👤
**Responsibilities:**
- Create subscriptions
- Manage profile with location and allergies
- View orders
- Track deliveries
- Skip meals
- Manage preferences

**Profile Features:**
- Full name, email, phone
- Address
- Google Maps location
- Allergy notifications
- Dietary preferences
- Special instructions

---

## 🗄️ New Database Tables

### Kitchen Management
```
kitchens
├── id, name, region, address
├── managerId (FK to users)
├── capacity, operatingHours
└── status

kitchen_prep_schedule
├── orderId, kitchenId
├── mealType (breakfast/lunch/dinner)
├── status (pending/completed)
├── assignedTo (staff member)
├── qualityCheck (pass/fail)
└── notes
```

### Delivery Management
```
delivery_schedules
├── kitchenId, scheduledDate
├── mealType
├── status, totalOrders
├── preparedOrders
└── notes

delivery_assignments
├── orderId, deliveryPersonId
├── kitchenId, status
├── scheduledDeliveryTime
└── notes

deliveries (enhanced)
├── orderId, deliveryPersonId
├── customerId, status
├── customerAddress
├── googleMapLocation
├── confirmationCode
├── confirmedByExecutive
└── confirmedAt
```

### Enhanced Subscriptions
```
subscriptions (enhanced)
├── mealTiming (breakfast/lunch/dinner/all)
├── specialInstructions
├── allergies
└── googleMapLocation
```

---

## 🔄 API Endpoints by Authority

### Kitchen Manager Endpoints
```
GET  /api/kitchen-manager/operations          - View kitchen operations
POST /api/kitchen-manager/schedule-delivery   - Schedule delivery
PUT  /api/kitchen-manager/schedule/:id/status - Update schedule status
POST /api/kitchen-manager/assign-delivery     - Assign to delivery person
PUT  /api/kitchen-manager/confirm-delivery/:id - Confirm delivery
```

### Kitchen Staff Endpoints
```
GET  /api/kitchen-staff/orders-to-prepare    - View orders by meal type
PUT  /api/kitchen-staff/order/:id/mark-prepared - Mark as prepared
PUT  /api/kitchen-staff/order/:id/quality-check - Quality check
```

### Admin Executive Endpoints
```
POST /api/admin-executive/subscriptions      - Create subscription
PUT  /api/admin-executive/delivery/:id/confirm - Confirm delivery
```

### Organization Head Endpoints
```
GET  /api/org-head/dashboard                 - Complete overview
GET  /api/org-head/regions                   - Regional performance
GET  /api/org-head/staff                     - All staff members
GET  /api/org-head/progress                  - Monthly progress
```

### Super Admin Endpoints
```
POST   /api/super-admin/users               - Create user
DELETE /api/super-admin/users/:id           - Delete user
GET    /api/super-admin/users               - View all users
POST   /api/super-admin/kitchens            - Create kitchen
```

### Customer Endpoints
```
GET  /api/customer/profile                  - Get profile
PUT  /api/customer/profile                  - Update profile with location/allergies
GET  /api/subscriptions                     - View subscriptions
```

---

## 📱 PWA Implementation

### Files Needed

1. **salad_caffe_extended.html** - Main frontend (includes all authorities)
2. **server_extended.js** - Enhanced backend with all endpoints
3. **manifest.json** - PWA manifest for installation
4. **sw.js** - Service Worker for offline support
5. **package.json** - Dependencies

### Installation Steps

#### Step 1: Setup Backend
```bash
# Replace server.js with server_extended.js
cp server_extended.js server.js

# Or keep both and specify in start command
node server_extended.js
```

#### Step 2: Setup Frontend
```bash
# Replace HTML file
cp salad_caffe_extended.html index.html

# Or serve directly
# The server will automatically serve it
```

#### Step 3: Add PWA Files
```bash
# Ensure these are in your public directory
cp manifest.json public/
cp sw.js public/
```

#### Step 4: Start Server
```bash
npm install
node server.js
```

#### Step 5: Install PWA

**On Android Chrome:**
1. Open http://localhost:3000
2. Click menu (3 dots)
3. Click "Install app" or "Add to Home screen"
4. Confirm installation

**On iPhone Safari:**
1. Open http://localhost:3000
2. Click Share button
3. Click "Add to Home Screen"
4. Confirm installation

---

## 🧪 Test Credentials

Use these to test different authorities:

```
Kitchen Manager:
  Email: kitchen@test.com
  Password: password123
  
Kitchen Staff:
  Email: staff@test.com
  Password: password123

Admin Executive:
  Email: admin@test.com
  Password: password123

Organization Head:
  Email: orghead@test.com
  Password: password123

Super Admin:
  Email: super@test.com
  Password: password123

Customer:
  Email: customer@test.com
  Password: password123
```

### Create Test Accounts (CLI)

```bash
# Login as Super Admin first
# Then use API endpoint to create users:

POST /api/super-admin/users
{
  "name": "Test Kitchen Manager",
  "email": "kitchen@test.com",
  "password": "password123",
  "authority": "kitchen_manager",
  "region": "Thiruvananthapuram",
  "kitchenId": 1
}
```

---

## 🔒 Security Features

1. **JWT Authentication**
   - 7-day token expiration
   - Token stored in localStorage
   - Passed in Authorization header

2. **Password Hashing**
   - bcryptjs with 10 salt rounds
   - Never stored as plain text

3. **Role-Based Access Control (RBAC)**
   - Each endpoint checks user authority
   - Unauthorized access blocked
   - Prevents privilege escalation

4. **Input Validation**
   - All inputs validated server-side
   - SQL injection protection
   - XSS prevention

---

## 🌐 Customer Profile with Location

### Fields
```
Profile Form:
├── Full Name
├── Email (read-only)
├── Phone Number
├── Home Address
├── Google Maps Location Link
├── Allergies/Dietary Restrictions
└── Special Instructions
```

### Allergy Notifications
- Stored in database
- Displayed to kitchen staff when preparing meals
- Prevents cross-contamination
- Alert badge in order prep screen

### Google Maps Location
- Customers provide their location link
- Used by delivery persons to navigate
- Exact address on file
- Alternative to manual address entry

---

## 🍽️ Meal Preparation Workflow

### For Kitchen Staff

**Step 1: Login**
- Login as kitchen_staff

**Step 2: View Orders**
- Click "Meal Prep" in navigation
- Filter by meal type (Breakfast, Lunch, Dinner)
- See all orders for that meal time

**Step 3: Order Details**
```
Each order shows:
├── Customer Name
├── Customer Address
├── Meal Name & Type
├── Allergies (RED ALERT)
├── Special Instructions from subscription
├── Special Instructions from order
└── Status
```

**Step 4: Prepare Meal**
- Follow the special instructions
- **IMPORTANT:** Check allergies first
- Prepare according to dietary restrictions

**Step 5: Mark Prepared**
- Click "Mark as Prepared"
- Add any notes
- Move to quality check

**Step 6: Quality Check**
- Verify meal quality
- Check portions
- Verify allergen safety
- Click "Pass" or "Fail"

---

## 🚚 Delivery Schedule Workflow

### For Kitchen Manager

**Step 1: Schedule Delivery**
- Click "Schedule Delivery" button
- Set date and time
- Choose meal type (breakfast/lunch/dinner)
- Add notes (traffic, special instructions, etc.)

**Step 2: View Schedule**
- See all scheduled deliveries
- Monitor prep progress
- Update schedule status as needed

**Step 3: Assign Deliveries**
- View pending orders
- Select delivery person
- Set scheduled delivery time
- Confirm assignment

**Step 4: Confirm Delivery**
- If delivery person doesn't mark delivered
- Kitchen manager can confirm in system
- Useful for offline deliveries
- Add confirmation notes

---

## 📊 Organization Head Insights

### Dashboard Shows:
- Total customers in system
- Active subscriptions count
- Total kitchens across regions
- Total delivery personnel
- Regional performance breakdown
- Monthly progress (orders, revenue)

### Regional Performance:
```
Each region shows:
├── Region name
├── Number of kitchens
├── Number of staff
└── Total orders processed
```

### Monthly Progress:
```
Each day shows:
├── Date
├── Total orders
├── Delivered orders
├── Daily revenue
└── Completion percentage
```

---

## 👑 Super Admin Full Control

### User Management
- Create any user with any authority
- View all users in system
- Delete users if needed
- Reset passwords (implement as needed)

### Kitchen Management
- Create new kitchens
- Assign managers to kitchens
- View all kitchen operations
- Manage kitchen capacity

### System Configuration
- Monitor all operations
- View system-wide metrics
- Manage authorities and permissions
- Access logs and analytics

---

## 🚀 Deployment for PWA

### Option 1: Railway.app (Recommended)
```bash
# 1. Create account at railway.app
# 2. Connect GitHub or upload files
# 3. Set environment variables
# 4. Deploy

# Environment variables:
JWT_SECRET=your_random_secret_key
NODE_ENV=production
PORT=3000
```

### Option 2: Render.com
```bash
# 1. Create account at render.com
# 2. Create new Web Service
# 3. Connect repository
# 4. Set build command: npm install
# 5. Set start command: node server.js
# 6. Deploy
```

### Option 3: Fly.io (Free Tier)
```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Login
flyctl auth login

# Deploy
flyctl launch
flyctl deploy
```

### PWA Installation Link
After deployment, users can:
1. Visit your domain
2. See "Install App" prompt
3. Install to home screen
4. Works offline with service worker

---

## 📱 PWA Features

### Installed App Behavior
- Looks like native app
- No address bar visible
- Full screen experience
- Splash screen on launch
- Custom app icon

### Offline Support
- Service Worker caches data
- Works offline for viewing cached data
- Syncs when connection restored
- Background sync for pending orders

### Push Notifications
- Delivery notifications
- Order updates
- Subscription reminders
- Can work when app is closed

---

## 🔧 Customization

### Change App Name
```json
// In manifest.json
{
  "name": "Your Company Name - Meal Service",
  "short_name": "Your Service"
}
```

### Change Colors
```css
/* In salad_caffe_extended.html */
:root {
  --primary: #2ecc71;        /* Change this */
  --primary-dark: #27ae60;   /* And this */
}
```

### Add New Authority
1. Add to backend validation
2. Add new table for permissions
3. Create new dashboard section
4. Add to navigation map
5. Implement endpoints

---

## 📋 Implementation Checklist

- [ ] Replace server.js with server_extended.js
- [ ] Replace HTML with salad_caffe_extended.html
- [ ] Add manifest.json to public folder
- [ ] Add sw.js to public folder
- [ ] Create test user accounts
- [ ] Test each authority dashboard
- [ ] Test meal prep workflow
- [ ] Test delivery assignment
- [ ] Test customer profile with location
- [ ] Test allergy notifications
- [ ] Test PWA installation (Android & iOS)
- [ ] Test offline functionality
- [ ] Deploy to Railway/Render/Fly
- [ ] Set up custom domain
- [ ] Get SSL certificate
- [ ] Configure email notifications
- [ ] Train staff on system

---

## 🎉 You're Ready!

Your complete meal subscription system with:
- ✅ 6 different user authorities
- ✅ Kitchen operations management
- ✅ Delivery scheduling & tracking
- ✅ Customer location & allergies
- ✅ Meal prep workflow
- ✅ PWA for mobile installation
- ✅ Offline support
- ✅ Production-ready code

**Start with:**
```bash
npm install
node server.js
# Visit http://localhost:3000
```

**Deploy with:**
- Railway.app (easiest)
- Render.com
- Fly.io (free tier)

**Questions?** Check the code comments for detailed implementation notes.

---

**Ready to launch your meal service! 🥗🚀**
