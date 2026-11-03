import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import multer from "multer";
import { createRemoteJWKSet, jwtVerify } from "jose";

const PORT = 5000;
const FRONTEND_URL = process.env.FRONTEND_URL;
const app = express();

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());

const JWKS = createRemoteJWKSet(
  new URL(`${FRONTEND_URL}/api/auth/jwks`)
);

const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!req.headers.authorization?.startsWith("Bearer ") || !token) {
    return res.status(401).send({ message: "Unauthorized! Token required." });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload;
    next();
  } catch (error) {
    console.error("Token verification failed:", error.message);
    res.status(401).send({ message: "Invalid or expired token!" });
  }
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    file.mimetype.startsWith("image/")
      ? cb(null, true)
      : cb(new Error("Only image files are allowed")),
});

const client = new MongoClient(process.env.MONGO_URI);
await client.connect();

console.log("MongoDB connected successfully!");

const db = client.db("book-nook");
const booksCollection = db.collection("books");
const borrowsCollection = db.collection("borrows");

const getLoggedInUser = async (req) => {
  try {
    const cookie = req.headers.cookie;
    if (!cookie) return null;

    const response = await fetch(`${FRONTEND_URL}/api/auth/get-session`, {
      headers: { cookie },
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data?.user?.email ? data.user : null;
  } catch (error) {
    console.error("Session error:", error);
    return null;
  }
};

const uploadImage = async (file) => {
  if (!file) return null;
  if (!process.env.IMGBB_API_KEY) throw new Error("ImgBB API key is missing");

  const formData = new FormData();
  formData.append("image", file.buffer.toString("base64"));

  const response = await fetch(
    `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`,
    { method: "POST", body: formData }
  );

  const data = await response.json();
  if (!response.ok || !data.success) throw new Error("Image upload failed");

  return data.data.display_url;
};

const getEmail = (user) => user?.email?.trim().toLowerCase();

app.get("/", (req, res) => {
  res.send("BookNook server is running!");
});

// Get all books
app.get("/books", async (req, res) => {
  try {
    const books = await booksCollection.find().sort({ createdAt: -1 }).toArray();
    res.send(books);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to fetch books" });
  }
});

// Get single book
app.get("/books/:id", verifyToken, async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).send({ message: "Invalid book ID" });
    }

    const book = await booksCollection.findOne({
      _id: new ObjectId(req.params.id),
    });

    if (!book) return res.status(404).send({ message: "Book not found" });
    res.send(book);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to fetch book details" });
  }
});

// Add book
app.post("/add-book", verifyToken, upload.single("image"), async (req, res) => {
  try {
    const user = req.user;
    const email = getEmail(user);

    if (!email) return res.status(401).send({ message: "User email not found in token" });
    if (!req.file) return res.status(400).send({ message: "Please select a book image" });

    const { title, author, category, rating, totalCopies, description } = req.body;

    if (
      !title?.trim() || title.trim().length < 2 ||
      !author?.trim() || !category?.trim() ||
      !description?.trim() || description.trim().length < 10 ||
      !Number.isInteger(Number(totalCopies)) || Number(totalCopies) < 1 ||
      !Number.isFinite(Number(rating)) || Number(rating) < 0 || Number(rating) > 5
    ) {
      return res.status(400).send({ message: "Please provide valid book information" });
    }

    const imageUrl = await uploadImage(req.file);
    const copies = Number(totalCopies);

    const result = await booksCollection.insertOne({
      title: title.trim(),
      author: author.trim(),
      category: category.trim(),
      imageUrl,
      rating: Number(rating),
      totalCopies: copies,
      availableCopies: copies,
      description: description.trim(),
      addedByName: user.name || "",
      addedByEmail: email,
      createdAt: new Date(),
    });

    res.status(201).send({
      success: true,
      message: "Book added successfully!",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: error.message || "Failed to add book" });
  }
});

// Borrow book
app.post("/borrow/:id", async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) return res.status(401).send({ message: "Please login first" });

    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid book ID" });

    const bookId = new ObjectId(id);
    const email = getEmail(user);
    const book = await booksCollection.findOne({ _id: bookId });

    if (!book) return res.status(404).send({ message: "Book not found" });

    const existing = await borrowsCollection.findOne({
      bookId, borrowerEmail: email, status: "borrowed",
    });

    if (existing) {
      return res.status(409).send({ message: "You have already borrowed this book" });
    }

    const update = await booksCollection.updateOne(
      { _id: bookId, availableCopies: { $gt: 0 } },
      { $inc: { availableCopies: -1 } }
    );

    if (!update.modifiedCount) {
      return res.status(409).send({ message: "This book is unavailable" });
    }

    const borrowDate = new Date();
    const returnDate = new Date(borrowDate.getTime() + 5 * 86400000);

    try {
      await borrowsCollection.insertOne({
        bookId,
        bookTitle: book.title,
        bookImage: book.imageUrl,
        borrowerName: user.name || "",
        borrowerEmail: email,
        borrowDate,
        returnDate,
        status: "borrowed",
        returnedAt: null,
      });
    } catch (error) {
      await booksCollection.updateOne(
        { _id: bookId },
        { $inc: { availableCopies: 1 } }
      );
      throw error;
    }

    res.send({ success: true, message: "Book borrowed successfully!" });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to borrow book" });
  }
});

// Get my books
app.get("/my-books", verifyToken, async (req, res) => {
  try {
    const email = getEmail(req.user);
    if (!email) return res.status(401).send({ message: "User email not found in token" });

    const books = await booksCollection.find({ addedByEmail: email })
      .sort({ createdAt: -1 }).toArray();

    res.send(books);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to fetch your books" });
  }
});

// Edit my book
app.patch("/books/:id", verifyToken, upload.single("image"), async (req, res) => {
  try {
    const email = getEmail(req.user);
    if (!email) return res.status(401).send({ message: "User email not found in token" });

    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid book ID" });

    const filter = { _id: new ObjectId(id), addedByEmail: email };
    const book = await booksCollection.findOne(filter);

    if (!book) return res.status(404).send({ message: "Book not found" });

    const { title, author, category, rating, totalCopies, description } = req.body;

    if (
      !title?.trim() || !author?.trim() || !category?.trim() ||
      !description?.trim() ||
      !Number.isFinite(Number(rating)) || Number(rating) < 0 || Number(rating) > 5 ||
      !Number.isInteger(Number(totalCopies)) || Number(totalCopies) < 1
    ) {
      return res.status(400).send({ message: "Invalid book information" });
    }

    const copies = Number(totalCopies);
    const borrowedCopies = book.totalCopies - book.availableCopies;

    if (copies < borrowedCopies) {
      return res.status(400).send({
        message: `At least ${borrowedCopies} copies are currently borrowed`,
      });
    }

    const imageUrl = (await uploadImage(req.file)) || book.imageUrl;

    await booksCollection.updateOne(filter, {
      $set: {
        title: title.trim(),
        author: author.trim(),
        category: category.trim(),
        description: description.trim(),
        rating: Number(rating),
        totalCopies: copies,
        availableCopies: copies - borrowedCopies,
        imageUrl,
      },
    });

    res.send({ success: true, message: "Book updated successfully!" });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: error.message || "Failed to update book" });
  }
});

// Delete my book
app.delete("/books/:id", verifyToken, async (req, res) => {
  try {
    const email = getEmail(req.user);
    if (!email) return res.status(401).send({ message: "User email not found in token" });

    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid book ID" });

    const bookId = new ObjectId(id);
    const filter = { _id: bookId, addedByEmail: email };
    const book = await booksCollection.findOne(filter);

    if (!book) return res.status(404).send({ message: "Book not found" });

    const activeBorrow = await borrowsCollection.findOne({
      bookId, status: "borrowed",
    });

    if (activeBorrow) {
      return res.status(409).send({
        message: "Cannot delete a book while it is borrowed",
      });
    }

    const result = await booksCollection.deleteOne(filter);
    if (!result.deletedCount) return res.status(404).send({ message: "Book not found" });

    res.send({ success: true, message: "Book deleted successfully!" });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to delete book" });
  }
});

// Get my borrows
app.get("/my-borrows", verifyToken, async (req, res) => {
  try {
    const email = getEmail(req.user);
    if (!email) return res.status(401).send({ message: "User email not found in token" });

    const borrows = await borrowsCollection.find({ borrowerEmail: email })
      .sort({ borrowDate: -1 }).toArray();

    const now = new Date();

    res.send(borrows.map((borrow) => {
      const borrowDate = borrow.borrowDate || borrow.borrowedAt;
      const returnDate = borrow.returnDate ||
        (borrowDate ? new Date(new Date(borrowDate).getTime() + 5 * 86400000) : null);

      return {
        ...borrow,
        borrowDate,
        returnDate,
        overdue: borrow.status === "borrowed" && returnDate && new Date(returnDate) < now,
      };
    }));
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to fetch borrow records" });
  }
});

// Return book
app.patch("/return/:id", async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) return res.status(401).send({ message: "Please login first" });

    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid borrow ID" });

    const borrow = await borrowsCollection.findOneAndUpdate(
      {
        _id: new ObjectId(id),
        borrowerEmail: getEmail(user),
        status: "borrowed",
      },
      { $set: { status: "returned", returnedAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!borrow) {
      return res.status(404).send({ message: "Active borrow record not found" });
    }

    const bookUpdate = await booksCollection.updateOne(
      { _id: borrow.bookId },
      { $inc: { availableCopies: 1 } }
    );

    if (!bookUpdate.matchedCount) {
      console.error("Returned borrow has no matching book:", borrow.bookId);
    }

    res.send({ success: true, message: "Book returned successfully!" });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to return book" });
  }
});

// Error handler
app.use((error, req, res, next) => {
  res.status(400).send({ message: error.message || "Something went wrong" });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default app; 
