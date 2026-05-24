const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ECS Deployment</title>
  <style>
    body {
      margin: 0;
      font-family: Arial, Helvetica, sans-serif;
      background: linear-gradient(135deg, #0f172a, #1e293b);
      color: #fff;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      text-align: center;
    }
    .card {
      background: rgba(255, 255, 255, 0.1);
      padding: 40px 60px;
      border-radius: 16px;
      backdrop-filter: blur(10px);
      box-shadow: 0 8px 20px rgba(0,0,0,0.3);
      animation: fadeIn 1.2s ease;
    }
    h1 {
      font-size: 2.2rem;
      margin-bottom: 10px;
    }
    p {
      font-size: 1.1rem;
      opacity: 0.9;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>🚀 Hello from ECS</h1>
    <h2>Congratulations FOSS</h2>
    <p>Your pipeline is working perfectly.</p>
  </div>
</body>
</html>
`);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});