# Military Medical Committee System (MMC-MMS) - Backend API

## 🚀 Overview
The **love-api** is the backend engine for the Military Medical Committee System. It serves as a secure middleware layer between the frontend and Supabase, providing specialized endpoints for queue management, patient routing, and administrative operations.

## ✨ Key Features
- **Unified API Layer**: Centralized control for all medical committee workflows via `/api/v1`.
- **Supabase Integration**: Direct, high-performance connection to Supabase Postgres and Realtime.
- **Secure Authentication**: Role-based access control for admins, doctors, and staff.
- **Automated Routing**: Intelligent patient journey mapping through medical stations.
- **Health Monitoring**: Real-time system health checks and automated recovery logs.

## 🛠 Tech Stack
- **Runtime**: Node.js
- **Framework**: Vercel Serverless Functions
- **Database**: [Supabase](https://supabase.com/) (PostgreSQL)
- **Deployment**: [Vercel](https://vercel.com/)

## 📁 API Structure
- `/api/v1/health`: System health and connectivity status.
- `/api/v1/queue/*`: Queue operations (enter, call, advance, status).
- `/api/v1/patient/*`: Patient authentication and profile management.
- `/api/v1/admin/*`: Administrative controls and reports.

## 🔐 Security & Reliability
- **Source of Truth**: Supabase is the single, real-time source of truth for all data.
- **Legacy Removal**: All legacy KV-based logic and PIN systems have been fully removed and replaced with relational database logic.
- **Enhanced Resilience**: Integrated error handling and automated recovery mechanisms.

## 🚀 Deployment
Deployed as a serverless backend on Vercel.
- **Production URL**: [https://mmc-mms.com/api/v1](https://mmc-mms.com/api/v1)
- **Project ID**: `prj_kT2JVmLqN8l2i9opi07JRYugl8MP`

## 📄 License
Copyright © 2026 Military Medical Committee. All rights reserved.
