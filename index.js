import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";
import "dotenv/config";

const PORT = 5000;

const app = express();

app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGO_URI);

async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("MongoDB connected successfully!");

    return client.db("book-nook");
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    process.exit(1);
  }
}

// Connect database
const db = await connectToMongoDB();

// Create collections
const booksCollection = db.collection("books");
const borrowsCollection = db.collection("borrows");

app.get("/", (req, res) => {
  res.send("BookNook server is running!");
});

app.get("/test", (req, res) => {
  res.send({ msg: "BookNook API working!" });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});