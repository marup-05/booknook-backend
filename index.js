import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
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

const db = await connectToMongoDB();

const booksCollection = db.collection("books");
const borrowsCollection = db.collection("borrows");

app.get("/", (req, res) => {
  res.send("BookNook server is running!");
});

// Get all books
app.get("/books", async (req, res) => {
  try {
    const books = await booksCollection
      .find()
      .sort({ createdAt: -1 })
      .toArray();

    res.send(books);
  } catch (error) {
    console.error("Failed to fetch books:", error);
    res.status(500).send({ message: "Failed to fetch books" });
  }
});

// Get single book details
app.get("/books/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid book ID",
      });
    }

    const book = await booksCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!book) {
      return res.status(404).send({
        message: "Book not found",
      });
    }

    res.send(book);
  } catch (error) {
    console.error("Failed to fetch book details:", error);
    res.status(500).send({
      message: "Failed to fetch book details",
    });
  }
});

// Add a new book
app.post("/add-book", async (req, res) => {
  try {
    const data = req.body;

    const result = await booksCollection.insertOne({
      ...data,
      createdAt: new Date(),
    });

    res.send(result);
  } catch (error) {
    console.error("Failed to add book:", error);
    res.status(500).send({ message: "Failed to add book" });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
