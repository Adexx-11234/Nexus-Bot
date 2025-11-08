# WhatsApp Web Manager 🚀

A comprehensive web interface for managing WhatsApp sessions without requiring Telegram. Built with Node.js, Express, and vanilla JavaScript.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen.svg)
![Status](https://img.shields.io/badge/status-active-success.svg)

## 📑 Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [API Documentation](#api-documentation)
- [Database Schema](#database-schema)
- [Security](#security)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## ✨ Features

### Core Features
- 🔐 **Secure Authentication** - JWT-based auth with bcrypt password hashing
- 📱 **WhatsApp Integration** - Direct WhatsApp session management via pairing codes
- 🎨 **Theme Support** - Beautiful dark mode (dark blue) and light mode (cream) themes
- 📊 **Real-time Stats** - Live session monitoring and statistics
- 🔄 **Auto-Reconnect** - Automatic session recovery with intelligent retry logic
- 🚦 **Rate Limiting** - Protection against brute force and abuse
- 📲 **Responsive Design** - Works seamlessly on desktop and mobile

### Technical Features
- **Dual Database Support** - PostgreSQL + MongoDB
- **Session Persistence** - Sessions survive server restarts
- **Memory Caching** - Fast data access with intelligent caching
- **Write Buffering** - Optimized database writes
- **Health Monitoring** - Built-in health checks and status endpoints

## 🏗️ Architecture

### Project Structure

```
web/
├── index.js                      # Main router & entry point
├── middleware/
│   ├── auth.js                  # JWT authentication middleware
│   └── rate-limit.js            # Rate limiting protection
├── routes/
│   ├── auth.js                  # Authentication endpoints
│   ├── session.js               # Session management endpoints
│   └── api.js                   # Additional API endpoints
├── controllers/
│   ├── auth-controller.js       # Authentication business logic
│   └── session-controller.js    # Session operation handlers
├── services/
│   ├── user-service.js          # User database operations
│   └── web-session-service.js   # WhatsApp session integration
├── public/
│   ├── css/
│   │   └── styles.css           # Complete styling system
│   ├── js/
│   │   ├── auth.js              # Login/register client logic
│   │   ├── dashboard.js         # Dashboard management
│   │   └── theme.js             # Theme switching
│   └── assets/
│       └── (icons/images)
└── views/
    ├── login.html               # Login page
    ├── register.html            # Registration page
    └── dashboard.html           # Main dashboard
```

### Technology Stack

**Backend:**
- Node.js (v16+)
- Express.js
- PostgreSQL
- MongoDB
- JWT (jsonwebtoken)
- bcrypt

**Frontend:**
- Vanilla JavaScript (ES6+)
- CSS3 with CSS Variables
- HTML5

## 📋 Prerequisites

- Node.js >= 16.0.0
- PostgreSQL >= 12
- MongoDB >= 4.4
- npm or yarn

## 🚀 Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd whatsapp-web-manager
```

### 2. Install Dependencies

```bash
npm install
```

Required packages:
```bash
npm install express dotenv bcrypt jsonwebtoken cookie-parser
```

### 3. Database Setup

#### PostgreSQL Tables

```sql
-- Users table
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,  
    first_name VARCHAR(255),
    username VARCHAR(255),
    session_id VARCHAR(255),
    phone_number VARCHAR(50),
    is_connected BOOLEAN DEFAULT FALSE,
    connection_status VARCHAR(50) DEFAULT 'disconnected',
    reconnect_attempts INTEGER DEFAULT 0,
    source VARCHAR(50) DEFAULT 'telegram',
    detected BOOLEAN DEFAULT FALSE,
    detected_at TIMESTAMP,
    is_admin BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Web users authentication table
CREATE TABLE IF NOT EXISTS web_users_auth (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_users_telegram_id ON users(telegram_id);
CREATE INDEX idx_users_phone ON users(phone_number);
CREATE INDEX idx_users_source ON users(source);
CREATE INDEX idx_users_session ON users(session_id);
```

#### MongoDB Collections

The following collections are automatically created:
- `sessions` - Session metadata
- `auth_baileys` - WhatsApp authentication data

### 4. Environment Configuration

Create a `.env` file in the root directory:

```env
# Server Configuration
PORT=3000
NODE_ENV=production
ALLOW_GRACEFUL_SHUTDOWN=true

# Security Keys (CHANGE THESE!)
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
SESSION_ENCRYPTION_KEY=your-encryption-key-change-this-too

# Database - PostgreSQL
DATABASE_URL=postgresql://user:password@localhost:5432/whatsapp_db

# Database - MongoDB
MONGODB_URI=mongodb://localhost:27017/whatsapp_sessions
# Or MongoDB Atlas:
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/dbname

# Optional: Session Manager
MAX_SESSIONS=50
SESSION_CONCURRENCY_LIMIT=5
```

## ⚙️ Configuration

### User ID System

The system uses a unified ID approach:

- **Telegram Users**: Natural Telegram IDs (e.g., 123456789)
- **Web Users**: Auto-generated IDs starting from 9000000000
- **Session IDs**: Format `session_<telegram_id>` (e.g., `session_9000000001`)

**Important**: No hyphens or special characters in session IDs - just `session_` prefix + numeric ID.

### JWT Configuration

JWT tokens include:
```javascript
{
  userId: telegram_id,           // The telegram_id (numeric)
  phoneNumber: "+1234567890",
  type: "web"
}
```

Token expiration: 7 days

### Rate Limiting

Default limits:
- Authentication: 5 requests / 5 minutes
- Session creation: 5 requests / 5 minutes  
- General API: 100 requests / minute

## 📖 Usage

### Starting the Server

```bash
# Development
npm run dev

# Production
npm start
```

The server will start on `http://localhost:3000`

### Access Points

- **Web Interface**: `http://localhost:3000`
- **Login**: `http://localhost:3000/login`
- **Register**: `http://localhost:3000/register`
- **Dashboard**: `http://localhost:3000/dashboard`
- **Health Check**: `http://localhost:3000/health`
- **API Status**: `http://localhost:3000/api/status`

### User Registration Flow

1. Visit `/register`
2. Enter:
   - First name (optional)
   - Phone number with country code (e.g., +2348012345678)
   - Password (minimum 8 characters)
   - Confirm password
3. Click "Create Account"
4. Automatic redirect to dashboard

### Connecting WhatsApp

1. Login to dashboard
2. Enter your WhatsApp phone number (with country code)
3. Click "Connect WhatsApp"
4. Wait for 8-digit pairing code to appear
5. Open WhatsApp on your phone:
   - Go to Settings → Linked Devices
   - Tap "Link a Device"
   - Select "Link with phone number instead"
   - Enter the pairing code
6. Connection established!

### Pairing Code Details

- **Format**: 8-digit numeric code
- **Validity**: 90 seconds
- **Click to copy**: Click the code to copy to clipboard
- **Auto-refresh**: Dashboard polls for code every 2 seconds

## 🔌 API Documentation

### Authentication Endpoints

#### Register User
```http
POST /auth/register
Content-Type: application/json

{
  "firstName": "John",
  "phoneNumber": "+1234567890",
  "password": "securePassword123"
}

Response:
{
  "success": true,
  "token": "jwt.token.here",
  "user": {
    "id": 9000000001,
    "phoneNumber": "+1234567890",
    "firstName": "John"
  }
}
```

#### Login
```http
POST /auth/login
Content-Type: application/json

{
  "phoneNumber": "+1234567890",
  "password": "securePassword123"
}

Response:
{
  "success": true,
  "token": "jwt.token.here",
  "user": { ... }
}
```

#### Verify Token
```http
GET /auth/verify
Cookie: auth_token=jwt.token.here

Response:
{
  "success": true,
  "user": { ... }
}
```

#### Logout
```http
POST /auth/logout

Response:
{
  "success": true,
  "message": "Logged out successfully"
}
```

### Session Management Endpoints

All session endpoints require authentication (JWT token in cookie or Authorization header).

#### Get Session Status
```http
GET /api/sessions/status
Authorization: Bearer <token>

Response:
{
  "success": true,
  "status": {
    "sessionId": "session_9000000001",
    "isConnected": true,
    "connectionStatus": "connected",
    "phoneNumber": "+1234567890",
    "hasActiveSocket": true,
    "canReconnect": false
  }
}
```

#### Create Session
```http
POST /api/sessions/create
Authorization: Bearer <token>
Content-Type: application/json

{
  "phoneNumber": "+1234567890"
}

Response:
{
  "success": true,
  "sessionId": "session_9000000001",
  "message": "Session created. Please scan QR code or enter pairing code."
}
```

#### Get Pairing Code
```http
GET /api/sessions/pairing-code
Authorization: Bearer <token>

Response:
{
  "success": true,
  "pairingCode": "12345678"
}
```

#### Disconnect Session
```http
POST /api/sessions/disconnect
Authorization: Bearer <token>

Response:
{
  "success": true,
  "message": "Session disconnected successfully"
}
```

#### Reconnect Session
```http
POST /api/sessions/reconnect
Authorization: Bearer <token>

Response:
{
  "success": true,
  "message": "Reconnection initiated"
}
```

#### Get Session Statistics
```http
GET /api/sessions/stats
Authorization: Bearer <token>

Response:
{
  "success": true,
  "stats": {
    "sessionId": "session_9000000001",
    "isConnected": true,
    "connectionStatus": "connected",
    "phoneNumber": "+1234567890",
    "reconnectAttempts": 0,
    "uptime": 3600000,
    "lastConnected": "2025-01-15T10:30:00Z",
    "createdAt": "2025-01-15T09:30:00Z"
  }
}
```

### User Profile Endpoints

#### Get Profile
```http
GET /api/profile
Authorization: Bearer <token>

Response:
{
  "success": true,
  "profile": {
    "id": 9000000001,
    "phoneNumber": "+1234567890",
    "firstName": "John",
    "username": null,
    "isConnected": true,
    "connectionStatus": "connected",
    "sessionId": "session_9000000001",
    "source": "web",
    "createdAt": "2025-01-15T09:00:00Z",
    "updatedAt": "2025-01-15T10:00:00Z"
  }
}
```

#### Update Profile
```http
PUT /api/profile
Authorization: Bearer <token>
Content-Type: application/json

{
  "firstName": "Johnny"
}

Response:
{
  "success": true,
  "profile": { ... }
}
```

#### Change Password
```http
POST /api/change-password
Authorization: Bearer <token>
Content-Type: application/json

{
  "currentPassword": "oldPassword123",
  "newPassword": "newPassword456"
}

Response:
{
  "success": true,
  "message": "Password changed successfully"
}
```

### Response Format

All API responses follow this structure:

**Success:**
```json
{
  "success": true,
  "data": { ... }
}
```

**Error:**
```json
{
  "success": false,
  "error": "Error message"
}
```

### HTTP Status Codes

- `200` - Success
- `400` - Bad Request (validation error)
- `401` - Unauthorized (no token)
- `403` - Forbidden (invalid token)
- `404` - Not Found
- `429` - Too Many Requests (rate limit)
- `500` - Internal Server Error

## 💾 Database Schema

### PostgreSQL Schema

#### users table
```sql
Column              | Type         | Description
--------------------|--------------|----------------------------------
id                  | BIGSERIAL    | Primary key (auto-increment)
telegram_id         | BIGINT       | Unique user identifier (9B+ for web users)
first_name          | VARCHAR(255) | User's first name
username            | VARCHAR(255) | Optional username
session_id          | VARCHAR(255) | Format: session_<telegram_id>
phone_number        | VARCHAR(50)  | Phone with country code
is_connected        | BOOLEAN      | Current connection status
connection_status   | VARCHAR(50)  | connected/connecting/disconnected
reconnect_attempts  | INTEGER      | Failed reconnection count
source              | VARCHAR(50)  | 'web' or 'telegram'
detected            | BOOLEAN      | Session detection flag
detected_at         | TIMESTAMP    | Detection timestamp
is_admin            | BOOLEAN      | Admin privileges flag
is_active           | BOOLEAN      | Account active status
created_at          | TIMESTAMP    | Account creation time
updated_at          | TIMESTAMP    | Last update time
```

#### web_users_auth table
```sql
Column         | Type         | Description
---------------|--------------|---------------------------
user_id        | BIGINT       | FK to users.id (CASCADE)
password_hash  | VARCHAR(255) | bcrypt hashed password
created_at     | TIMESTAMP    | Auth record creation
updated_at     | TIMESTAMP    | Last password change
```

### MongoDB Collections

#### sessions collection
```javascript
{
  sessionId: "session_9000000001",
  telegramId: 9000000001,
  phoneNumber: "+1234567890",
  isConnected: true,
  connectionStatus: "connected",
  reconnectAttempts: 0,
  source: "web",
  detected: true,
  createdAt: ISODate("2025-01-15T09:00:00Z"),
  updatedAt: ISODate("2025-01-15T10:00:00Z")
}
```

#### auth_baileys collection
```javascript
{
  filename: "creds.json",
  sessionId: "session_9000000001",
  datajson: "{ encrypted auth data }",
  updatedAt: ISODate("2025-01-15T10:00:00Z")
}
```

## 🔒 Security

### Authentication Security

- **Password Hashing**: bcrypt with 10 salt rounds
- **JWT Tokens**: HTTP-only cookies with 7-day expiration
- **Token Validation**: Middleware on all protected routes
- **Rate Limiting**: Prevents brute force attacks

### Password Requirements

- Minimum 8 characters
- No maximum limit
- All character types allowed

### Session Security

- Session IDs are non-guessable (format: `session_<large_number>`)
- Auth data encrypted in MongoDB
- Automatic session cleanup on logout
- Voluntary disconnection tracking

### Best Practices

1. **Change default secrets** in `.env`
2. **Use HTTPS** in production
3. **Enable CORS** only for trusted domains
4. **Regular password rotation**
5. **Monitor failed login attempts**

## 🛠️ Development

### Code Structure

#### Controllers
Handle HTTP requests and responses, delegate to services.

```javascript
// Example: auth-controller.js
async register(phoneNumber, password, firstName) {
  // 1. Validate input
  // 2. Check existing users
  // 3. Hash password
  // 4. Create user via service
  // 5. Generate token
  // 6. Return response
}
```

#### Services
Handle business logic and database operations.

```javascript
// Example: user-service.js
async createWebUser({ phoneNumber, passwordHash, firstName }) {
  // 1. Generate unique ID
  // 2. Insert into users table
  // 3. Insert into auth table
  // 4. Return user object
}
```

#### Middleware
Process requests before reaching controllers.

```javascript
// Example: auth.js
export function authenticateToken(req, res, next) {
  // 1. Extract token
  // 2. Verify token
  // 3. Attach user to request
  // 4. Call next() or return 401
}
```

### Adding New Features

1. **New API Endpoint:**
   - Add route in `routes/`
   - Create controller method
   - Add service logic if needed
   - Update this README

2. **New Database Field:**
   - Create migration
   - Update service methods
   - Update TypeScript types (if using)
   - Test thoroughly

3. **New UI Component:**
   - Add HTML in `views/`
   - Add styles in `public/css/styles.css`
   - Add JS logic in `public/js/`
   - Ensure responsive design

### Testing

```bash
# Run health check
curl http://localhost:3000/health

# Test registration
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"+1234567890","password":"test1234"}'

# Test login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"+1234567890","password":"test1234"}'
```

### Logging

All components use structured logging:

```javascript
import { createComponentLogger } from '../utils/logger.js'
const logger = createComponentLogger('COMPONENT_NAME')

logger.info('Information message')
logger.warn('Warning message')
logger.error('Error message', error)
```

## 🐛 Troubleshooting

### Common Issues

#### 1. "Authentication required" on all requests

**Cause**: JWT token missing or invalid

**Solution:**
- Clear browser cookies
- Re-login
- Check `JWT_SECRET` in `.env`
- Verify token expiration (7 days)

#### 2. "Failed to create session"

**Causes:**
- Session manager not initialized
- MongoDB connection issue
- Max sessions limit reached (50)
- Invalid phone number format

**Solution:**
```bash
# Check server logs
tail -f logs/app.log

# Verify MongoDB connection
curl http://localhost:3000/health

# Check session count
curl http://localhost:3000/api/status
```

#### 3. Pairing code not appearing

**Causes:**
- WhatsApp socket creation failed
- Callback not properly registered
- Network timeout

**Solution:**
- Wait 2-3 seconds after clicking "Connect"
- Check browser console for errors
- Verify phone number includes country code
- Try disconnecting and reconnecting

#### 4. Session disconnects frequently

**Causes:**
- Network instability
- MongoDB connection issues
- WhatsApp server issues

**Solution:**
- Enable auto-reconnect (enabled by default)
- Check MongoDB connection health
- Review `reconnect_attempts` in database
- Check server logs for 401 errors

#### 5. Theme not persisting

**Cause**: localStorage not working

**Solution:**
- Check browser privacy settings
- Enable cookies and localStorage
- Clear browser cache
- Check browser console for errors

### Debug Mode

Enable detailed logging:

```env
NODE_ENV=development
LOG_LEVEL=debug
```

### Database Connection Issues

#### PostgreSQL
```bash
# Test connection
psql -h localhost -U username -d whatsapp_db

# Check active connections
SELECT count(*) FROM pg_stat_activity;
```

#### MongoDB
```bash
# Test connection
mongo mongodb://localhost:27017/whatsapp_sessions

# Check collections
show collections;
db.sessions.find().limit(5);
```

### Health Checks

```bash
# Basic health
curl http://localhost:3000/health

# Detailed status
curl http://localhost:3000/api/status

# Session statistics
curl -H "Authorization: Bearer <token>" \
  http://localhost:3000/api/sessions/stats
```

## 🤝 Contributing

We welcome contributions! Please follow these guidelines:

### Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Test thoroughly
5. Commit with clear messages (`git commit -m 'Add amazing feature'`)
6. Push to branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Code Style

- Use ES6+ features
- Follow existing code structure
- Add JSDoc comments for functions
- Use meaningful variable names
- Keep functions small and focused

### Commit Messages

Format:
```
type(scope): subject

body (optional)

footer (optional)
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting
- `refactor`: Code restructuring
- `test`: Tests
- `chore`: Maintenance

Example:
```
feat(auth): add two-factor authentication

Implement TOTP-based 2FA for enhanced security.
Users can enable 2FA in profile settings.

Closes #123
```

### Pull Request Checklist

- [ ] Code follows project style
- [ ] All tests pass
- [ ] Documentation updated
- [ ] No console.log statements
- [ ] Error handling implemented
- [ ] Security considerations addressed

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Baileys](https://github.com/WhiskeySockets/Baileys) - WhatsApp Web API
- Express.js team
- MongoDB team
- PostgreSQL team
- All contributors

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/repo/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/repo/discussions)
- **Email**: support@example.com

## 🗺️ Roadmap

### v1.1 (Planned)
- [ ] QR code display option
- [ ] Email notifications
- [ ] Session analytics dashboard
- [ ] Export session data

### v1.2 (Future)
- [ ] Two-factor authentication
- [ ] Multi-device support
- [ ] Admin panel
- [ ] API key authentication

### v2.0 (Long-term)
- [ ] WebSocket real-time updates
- [ ] Group management features
- [ ] Message scheduling
- [ ] Webhook integrations

## 📊 Statistics

- **Lines of Code**: ~3,000+
- **Files**: 17
- **Dependencies**: 8 core packages
- **Supported Databases**: 2 (PostgreSQL, MongoDB)
- **API Endpoints**: 15+
- **Themes**: 2 (Light/Dark)

---

**Built with ❤️ by the Development Team**

*Last updated: January 2025*