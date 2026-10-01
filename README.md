# PawStay — Pet Grooming & Hotel (Capstone Project)

Full-stack app: Node.js + Express backend with a vanilla HTML/CSS/JS frontend served from the same server, using Firebase Authentication and Cloud Firestore.

## Features

- **Pet grooming booking** — bath, nail trim, haircut, deshedding, full groom
- **Pet hotel reservations** — standard / deluxe / suite rooms with nightly pricing
- **Customer records** — full CRUD
- **Pet records** — full CRUD, linked to owners
- **Admin monitoring dashboard** — live stats, 14-day hotel occupancy, recent activity feed, revenue breakdown by service
- **Admin point of sale** — multi-item counter sales from the service catalog or custom items, tender and change recording, printable receipts
- **Booking payments** — pay online through PayMongo QR Ph with GCash or choose counter cash; paid online bookings include viewable, printable receipts

## Setup

1. Copy `.env.example` to `.env`.
2. Provide Firebase Admin credentials using `GOOGLE_APPLICATION_CREDENTIALS` or the `FIREBASE_*` variables.
3. Add a PayMongo test secret key to `PAYMONGO_SECRET_KEY` for online QR Ph payments. Customers can scan the QR code with GCash. Leave it blank to offer counter cash only.
4. Set `APP_URL` to the public app URL used by PayMongo redirects (for local testing: `http://localhost:3000`).
5. Run `npm install`.
6. Start the app: `npm run dev`

The application uses Firebase Admin and Cloud Firestore for persistence. Firebase credentials must be configured before starting the server.

Then open:

- Public site: http://localhost:3000
- Admin dashboard: http://localhost:3000/admin/index.html

## Environment variables

- `GOOGLE_APPLICATION_CREDENTIALS` - path to a Firebase service-account JSON file
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` - alternative Firebase service-account settings
- `PORT` - server port (default: `3000`)
- `CORS_ORIGIN` - allowed frontend origin (blank = allow all, dev default)
- `SMTP_USER`, `SMTP_PASS` - optional Gmail SMTP credentials for booking confirmation emails; use a Gmail App Password
- `SMTP_FROM` - optional sender address (defaults to `SMTP_USER`)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` - optional Twilio SMS delivery for service reminders
- `REMINDER_TIME_ZONE` - timezone for booking date/time values (defaults to `Asia/Manila`)
- `PAYMONGO_SECRET_KEY` - PayMongo secret key used to create GCash Checkout Sessions; use a test key during development
- `APP_URL` - public base URL for PayMongo success and cancellation redirects

### Automated service reminders

The server checks every five minutes for confirmed grooming appointments and reserved/confirmed hotel stays approaching their 24-hour reminder time. Booking times are interpreted in `REMINDER_TIME_ZONE`. Reminder email requires SMTP configuration; SMS requires all three Twilio settings. At least one delivery channel must succeed for the booking to be marked as reminded. The admin-only `POST /api/v1/reminders/run` endpoint can run the same due-reminder check manually.

### Booking payments and confirmations

On the grooming and hotel forms, customers can choose **Pay at the counter (cash)** or **Pay online in advance via GCash QR**. Cash bookings are created as unpaid. QR Ph bookings are created as pending and redirect to PayMongo; after PayMongo returns the customer to the app, the Checkout Session is verified and the booking is marked paid. Customers can print the verified receipt immediately or reopen it from the paid booking in My Account.

PayMongo keys are required only for the GCash option. Never commit `.env` or live payment keys to the repository.

### Production deployment (Render + GoDaddy)

The app can run as one Render Node web service (`npm ci`, `npm start`) and uses `/api/health` for health checks. The included `render.yaml` defines an always-on paid service and prompts for required credentials instead of storing them in source control; review Render's current pricing before importing it. Render free services sleep and are not suitable for this live booking/payment system. Configure `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, and `ADMIN_PASS` in Render; the blueprint generates persistent `ADMIN_SECRET` and `CUSTOMER_SECRET` values. Checkout redirects use Render's assigned URL initially; set `APP_URL` to your custom `https://` domain after connecting it. Add `PAYMONGO_SECRET_KEY` and `PAYMONGO_WEBHOOK_SECRET` when enabling PayMongo; configure SMTP and Twilio variables only if those notifications are needed.

After the service deploys, verify its Render URL and health endpoint, add your purchased domain in Render, then copy Render's displayed DNS records into GoDaddy's DNS manager (remove conflicting `AAAA` records as Render instructs). Set `APP_URL` to the final `https://` domain and add the domain to Firebase Authentication's authorized domains. Register the HTTPS webhook URL `https://your-domain/webhooks/paymongo` in PayMongo, subscribe to `checkout_session.payment.paid`, and store the displayed signing secret as `PAYMONGO_WEBHOOK_SECRET`. Do not use live PayMongo keys until test checkout, webhook signature verification, admin login, and customer registration have been verified.

Admins can click **Confirm** for a pending grooming appointment or hotel reservation. The booking status changes to `confirmed`, and the customer receives an email when SMTP is configured. To use Gmail, enable 2-Step Verification on the sender account and create an App Password under Google Account security. Never commit the app password to the repository.

## Available scripts

- `npm start` - start the server
- `npm run dev` - start the server with nodemon

## API (base: `/api/v1`)

### Customers
- `GET /customers` · `GET /customers/:id` · `POST /customers` · `PUT /customers/:id` · `DELETE /customers/:id`

### Pets
- `GET /pets` · `GET /pets/:id` · `POST /pets` · `PUT /pets/:id` · `DELETE /pets/:id`

### Grooming appointments
- `GET /grooming` · `GET /grooming/:id` · `POST /grooming` · `PUT /grooming/:id` · `DELETE /grooming/:id`

### Hotel reservations
- `GET /hotel` · `GET /hotel/:id` · `POST /hotel` · `PUT /hotel/:id` · `DELETE /hotel/:id`

### Public one-shot bookings (customer + pet + booking in one request)
- `POST /bookings/grooming` — `{ customer, pets, service, date, time, notes, paymentMethod }`
- `POST /bookings/hotel` — `{ customer, pets, roomType, checkIn, checkOut, notes, paymentMethod }`
- `POST /payments/verify` — verifies a PayMongo Checkout Session after GCash payment

### Admin monitoring
- `GET /admin/stats` — counts, today's appointments, current guests, revenue
- `GET /admin/activity` — latest bookings across both services
- `GET /admin/occupancy` — hotel occupancy for the next 14 days
- `GET /admin/revenue-by-service` — revenue grouped by grooming service / room type
- `GET /admin/cash-transactions` — latest 100 staff-recorded cash transactions
- `POST /admin/cash-transactions` — record a walk-in sale or settle an unpaid cash booking

Walk-in sales accept the legacy `{ customerName, description, amount }` request or `{ customerName, contact, paymentMethod, tenderedAmount, items: [{ name, quantity, unitPrice, category }] }`. The server calculates and validates cart totals.

Staff can use `/admin/pos.html` for multi-item grooming/Ayurveda and custom counter sales, including cash, GCash, and card tender recording with printable receipts. `/admin/transactions.html` remains available to settle unpaid cash bookings and review recent transactions. Walk-in sales are included in dashboard revenue; booking payments update the booking record and are not double-counted as separate sales. Custom items are recorded as sale lines and do not track stock inventory.

## Structure

- `index.js` - app entry point (serves API + static frontend)
- `config/firebase.js` - Firebase Admin SDK initialization for Auth and Firestore
- `routes/index.js` - Express router
- `controllers/` - route handlers (customers, pets, grooming, hotel, bookings, admin)
- `models/` - Firestore-backed data models
- `util/errorHandler.js` - 404 and error middleware
- `public/` - frontend (public booking pages + admin dashboard)
