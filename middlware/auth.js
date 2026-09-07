const jwt = require("jsonwebtoken");
require("dotenv").config();

const jwtToken = process.env.JWT_SECRET;

const authenicateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token)
    return res.status(401).json({
      error: "Access token required",
    });

  jwt.verify(token, jwtToken, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Invalid or expired token" });
    }
    req.user = user;
    next();
  });
};

const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      returnres.status(403).json({
        error: `Access denied. Role '${req.user?.role}' is not authorized.`,
      });
    }
    next();
  };
};

module.exports = { authenicateToken, authorizeRoles };