require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET;
const {v2: cloudinary} = require("cloudinary");
const streamifier = require("streamifier");
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const app = express();

app.use(cors());
app.use(express.json());

const path = require("path");
app.use(express.static(path.join(__dirname, "../FrontEnd")));
// Connect MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch(err => console.log("❌ MongoDB Error:", err));
//MIDDLEWARE DO NOT TOUCH UNLESS ABSOLUTELY HAVE TO
function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header) {
    return res.status(401).json({ message: "No token" });
  }

  try {
    const token = header.split(" ")[1]; // "Bearer TOKEN"
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
}

//Register Page
const UserSchema = new mongoose.Schema({
  Username: {
    type: String,
    required: true,
    unique: true,
    trim: true

  },
  Email: {
   type: String,
   required: true,
   unique: true,
   trim: true
},

  Phone: {
   type: String,
   required: true,
   unique: true,
   trim: true
},
  Password: String
});

const SaleSchema = new mongoose.Schema({
    bookTitle: String,
    seller: String,
    buyer: String,
    soldAt: Date
});

const Sale = mongoose.model("Sale", SaleSchema);

const User = mongoose.model("User", UserSchema);

User.syncIndexes()
    .then(() => console.log("✅ User indexes synced"))
    .catch(err => console.log(err));

app.post("/register", async(req, res) => {
try {
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneRegex = /^[6-9]\d{9}$/;

if (!emailRegex.test(req.body.Email)) {
    return res.status(400).json({
        message: "Invalid email"
    });
}

if (!phoneRegex.test(req.body.Phone)) {
    return res.status(400).json({
        message: "Invalid phone number"
    });
}
const hashedPassword = await bcrypt.hash(req.body.Password, 10);

const user = new User({
  Email: req.body.Email,
  Phone: req.body.Phone,
  Username: req.body.Username,
  Password: hashedPassword
});
  await user.save();
  res.json({message: "User Registered"});
 }catch (err) {

    if (err.code === 11000) {

        if (err.keyPattern.Username) {
            return res.status(400).json({
                message: "Username already exists."
            });
        }

        if (err.keyPattern.Email) {
            return res.status(400).json({
                message: "Email already registered."
            });
        }

        if (err.keyPattern.Phone) {
            return res.status(400).json({
                message: "Phone number already registered."
            });
        }
    }

    res.status(500).json({
        message: "Server error."
    });
}
});
//Login
app.post("/login", async (req, res) => {
  try {
    const user = await User.findOne({ Username: req.body.Username });

    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }
    const isMatch = await bcrypt.compare(req.body.Password, user.Password);

    if (!isMatch) {
      return res.status(400).json({ message: "Wrong password" });
    }

    const token = jwt.sign(
      { userId: user._id },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login successful",
      token,
      username: user.Username
    });

  } catch (err) {
    res.status(500).json(err);
  }
});


// Schema
const ItemSchema = new mongoose.Schema({
  title: String,
  image: String,
  description: String,
  condition: String,
  qualityChecked: Boolean,
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  sellerName: String,
  status: {type: String, default: "Available"}
});

const Item = mongoose.model("Item", ItemSchema);

// Image upload setup
const storage = multer.memoryStorage();
const upload = multer({ storage });
//Cloudinary Image Setup
function uploadToCloudinary(buffer) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder: "kitaabi-keeda"
            },
            (error, result) => {
                if (error) reject(error);
                else resolve(result);
            }
        );

        streamifier.createReadStream(buffer).pipe(stream);
    });
}

// Add Item
app.post("/add-item", auth, upload.single("image"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({
        message: "No Image Uploaded"
});
}  

try {
    const result = await uploadToCloudinary(req.file.buffer);

    const user = await User.findById(req.userId);

    const item = new Item({
      title: req.body.title,
      image: result.secure_url,
      sellerId: req.userId,
      description: req.body.description,
      condition: req.body.condition,
      qualityChecked: req.body.qualityChecked === "true",
      sellerName: user.Username
    });

    await item.save();

    res.json({ success: true, message: "Item added!" });

  } catch (err) {
    res.status(500).json({ message: "Error adding item" });
  }
});

//Load My Listings
app.get("/my-items", auth, async (req, res) => {
  const items = await Item.find({
    sellerId: req.userId,
    status: { $ne: "Sold" }
  });

  res.json(items);
});
// Get Items
app.get("/items", async (req, res) => {
  try {
    const items = await Item.find({
        status: "Available"
});

res.json(items);


 }  catch (err) {
    res.status(500).json(err);
  }
});

//For Stats in User Dashboard

app.get("/my-sales", auth, async (req, res) => {
    const sales = await Sale.find({
        seller: req.userId
    });

    res.json(sales);
});

app.get("/my-purchases", auth, async (req, res) => {

    const buyer = await User.findById(req.userId);

    const purchases = await Sale.find({
        buyer: buyer.Username
    });

    res.json(purchases);
});


// Buy Item
app.delete("/buy-item/:id", auth, async (req, res) => {

try {
    const item = await Item.findById(req.params.id);

if (!item) {
 return res.status(404).json({
 message: "Item not Found"
});
}

const buyer = await User.findById(req.userId);
    const sale = new Sale ({
        bookTitle: item.title,
        seller: item.sellerId,
        buyer: buyer.Username,
        soldAt: new Date()
});

await sale.save();

item.status = "Sold";
await item.save();

    res.json({
      success: true,
      message: "Item bought"
    });
  } catch (err) {
    res.status(500).json(err);
  }
});

app.delete("/item/:id", auth, async (req, res) => {
  try {
    
    await Item.findByIdAndDelete(req.params.id);
    res.json({
      message: "Item deleted"
    });
  } catch (err) {
    res.status(500).json(err);
  }
});

app.get("/sales", async (req, res) => {
  try {
    const sales = await Sale.find();
    res.json(sales);
  } catch (err) {
    res.status(500).json(err);
  }
});
//Seperate Page
app.get("/item/:id", async (req, res) => {
  const item = await Item.findById(req.params.id);
  res.json(item);
});
// Start Server
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
