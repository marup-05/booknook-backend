import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";

const PORT = 5000;
const FRONTEND_URL = process.env.FRONTEND_URL?.replace(/\/$/, "");

const app = express();

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  }),
);

app.use(express.json());

// MongoDB connection
const client = new MongoClient(process.env.MONGO_URI);

await client.connect();

console.log("MongoDB connected successfully!");

const db = client.db("book-nook");

const booksCollection = db.collection("books");
const borrowsCollection = db.collection("borrows");

// Reusable Better Auth session verification
const getLoggedInUser = async (req) => {
  try {
    const cookie = req.headers.cookie;

    if (!cookie || !FRONTEND_URL) {
      return null;
    }

    const response = await fetch(`${FRONTEND_URL}/api/auth/get-session`, {
      headers: {
        cookie,
      },
    });

    if (!response.ok) {
      return null;
    }

    const sessionData = await response.json();

    return sessionData?.user?.email ? sessionData.user : null;
  } catch (error) {
    console.error("Session verification error:", error);
    return null;
  }
};
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
    console.error(error);
    res.status(500).send({ message: "Failed to fetch books" });
  }
});

// Get single book
app.get("/books/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid book ID" });
    }

    const book = await booksCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!book) {
      return res.status(404).send({ message: "Book not found" });
    }

    res.send(book);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to fetch book details" });
  }
});

// Add a new book
app.post("/add-book", async (req, res) => {
  try {
    const user = await getLoggedInUser(req);

    if (!user) {
      return res.status(401).send({
        message: "Please login first",
      });
    }

    const {
      title,
      author,
      category,
      imageUrl,
      rating,
      totalCopies,
      description,
    } = req.body;

    if (
      typeof title !== "string" ||
      title.trim().length < 2 ||
      typeof author !== "string" ||
      !author.trim() ||
      typeof category !== "string" ||
      !category.trim() ||
      typeof imageUrl !== "string" ||
      !imageUrl.trim() ||
      typeof description !== "string" ||
      description.trim().length < 10
    ) {
      return res.status(400).send({
        message: "Please provide valid book information",
      });
    }

    if (
      !Number.isInteger(Number(totalCopies)) ||
      Number(totalCopies) < 1 ||
      !Number.isFinite(Number(rating)) ||
      Number(rating) < 0 ||
      Number(rating) > 5
    ) {
      return res.status(400).send({
        message: "Please provide valid rating and copy information",
      });
    }

    const copies = Number(totalCopies);

    const bookData = {
      title: title.trim(),
      author: author.trim(),
      category: category.trim(),
      imageUrl: imageUrl.trim(),
      rating: Number(rating),
      totalCopies: copies,
      availableCopies: copies,
      description: description.trim(),

      // User information comes from verified Better Auth session
      addedByName: user.name || "",
      addedByEmail: user.email.trim().toLowerCase(),

      createdAt: new Date(),
    };

    const result = await booksCollection.insertOne(bookData);

    res.status(201).send({
      success: true,
      message: "Book added successfully!",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Add book error:", error);

    res.status(500).send({
      message: "Failed to add book",
    });
  }
});

// Borrow a book
app.post("/borrow/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid book ID" });
    }

    // Verify logged-in user
    const user = await getLoggedInUser(req);

    if (!user) {
      return res.status(401).send({
        message: "Please login first",
      });
    }

    const bookId = new ObjectId(id);
    const email = user.email.trim().toLowerCase();

    const book = await booksCollection.findOne({ _id: bookId });

    if (!book) {
      return res.status(404).send({ message: "Book not found" });
    }

    const existingBorrow = await borrowsCollection.findOne({
      bookId,
      borrowerEmail: email,
      status: "borrowed",
    });

    if (existingBorrow) {
      return res.status(409).send({
        message: "You have already borrowed this book",
      });
    }

    const updateResult = await booksCollection.updateOne(
      {
        _id: bookId,
        availableCopies: { $gt: 0 },
      },
      {
        $inc: { availableCopies: -1 },
      },
    );

    if (updateResult.modifiedCount === 0) {
      return res.status(409).send({
        message: "This book is currently unavailable",
      });
    }

    try {
      await borrowsCollection.insertOne({
        bookId,
        bookTitle: book.title,
        borrowerName: user.name || "",
        borrowerEmail: email,
        borrowedAt: new Date(),
        status: "borrowed",
      });
    } catch (error) {
      await booksCollection.updateOne(
        { _id: bookId },
        { $inc: { availableCopies: 1 } },
      );

      throw error;
    }

    res.send({
      success: true,
      message: "Book borrowed successfully!",
    });
  } catch (error) {
    console.error("Failed to borrow book:", error);

    res.status(500).send({
      message: "Failed to borrow book",
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
