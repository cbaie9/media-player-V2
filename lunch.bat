if not exist %cd%/config/users.json (npm install)
start "npm run rescan & exit /b"
npm start