const express = require('express')
const multer = require('multer')
const tesseract = require('node-tesseract-ocr')
const fs = require('fs')
const path = require('path')
const mysql = require('mysql2/promise')
const dotenv = require('dotenv')
const cors = require('cors')

const app = express()
  
dotenv.config()
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))

app.use(express.json()); // <-- THIS is critical
app.use(express.urlencoded({ extended: true })); // <-- THIS is critical
app.use(express.static('uploads')) // Serve static files from the uploads directory

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname))
  }
})

const upload = multer({ storage: storage })

// Tesseract OCR configuration
const config = {
  lang: "eng",
  oem: 1,
  psm: 3,
  binary: '"C:\\Program Files\\Tesseract-OCR\\tesseract.exe"'
}

// Test Tesseract OCR installation
async function testTesseract() {
  try {
    const testImagePath = path.resolve(__dirname, 'testimage.jpg')
    const testText = await tesseract.recognize(testImagePath, config)
    console.log('Tesseract OCR is working correctly')
  } catch (error) {
    console.error('Tesseract OCR test failed:', error)
  }
}

testTesseract()

// MySQL connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
})

// Create tables if not exists
async function initializeDatabase() {
  const connection = await pool.getConnection()
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ownerName VARCHAR(255),
        propertyLocation VARCHAR(255),
        cofoNumber VARCHAR(255),
        status ENUM('pending', 'verified', 'rejected') DEFAULT 'pending',
        filePath VARCHAR(255),
        metadata JSON,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await connection.query(`
      CREATE TABLE IF NOT EXISTS verification_details (
        id INT AUTO_INCREMENT PRIMARY KEY,
        documentId INT,
        status VARCHAR(255),
        notes TEXT,
        verifiedBy VARCHAR(255),
        verifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (documentId) REFERENCES documents(id) ON DELETE CASCADE
      )
    `)
  } finally {
    connection.release()
  }
}

initializeDatabase()

// Routes
app.post('/api/cofodocuments', upload.single('document'), async (req, res) => {
  try {
    const { ownerName, propertyLocation, cofoNumber } = req.body
    const filePath = req.file.path

    // OCR Processing with error handling
    let text
    try {
      text = await tesseract.recognize(path.resolve(filePath), config)
      console.log('OCR Result:', text)
    } catch (ocrError) {
      console.error('OCR Error:', ocrError)
      text = 'OCR processing failed'
    }

    const [result] = await pool.query(
      'INSERT INTO documents (ownerName, propertyLocation, cofoNumber, filePath, metadata) VALUES (?, ?, ?, ?, ?)',
      [ownerName, propertyLocation, cofoNumber, filePath, JSON.stringify(req.body)]
    )

    const [doc] = await pool.query('SELECT * FROM documents WHERE id = ?', [result.insertId])
    res.status(201).json(doc[0])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/cofdocuments/:id', async (req, res) => {
  try {
    const [doc] = await pool.query('SELECT * FROM documents WHERE id = ?', [req.params.id])
    if (!doc[0]) return res.status(404).json({ error: 'Document not found' })
    res.json(doc[0])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.put('/api/cofodocuments/:id', async (req, res) => {
  try {
    await pool.query(
      'UPDATE documents SET ? WHERE id = ?',
      [req.body, req.params.id]
    )
    const [doc] = await pool.query('SELECT * FROM documents WHERE id = ?', [req.params.id])
    if (!doc[0]) return res.status(404).json({ error: 'Document not found' })
    res.json(doc[0])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/cofodocuments', async (req, res) => {
  try {
    const filters = req.query
    let query = 'SELECT * FROM documents'
    const values = []

    if (Object.keys(filters).length > 0) {
      query += ' WHERE ' + Object.keys(filters).map(key => `${key} = ?`).join(' AND ')
      values.push(...Object.values(filters))
    }

    const [docs] = await pool.query(query, values)
    res.json(docs)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.delete('/api/cofodocuments/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM documents WHERE id = ?', [req.params.id])
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Document not found' })
    res.status(204).send()
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Verification endpoints
app.post('/api/cofodocuments/:id/verify', async (req, res) => {
  try {
    const [doc] = await pool.query('SELECT * FROM documents WHERE id = ?', [req.params.id])
    if (!doc[0]) return res.status(404).json({ error: 'Document not found' })

    const { status, notes, verifiedBy } = req.body
    
    console.log('Verification details:', { status, notes, verifiedBy })
    if (!status || !notes || !verifiedBy) {
      return res.status(400).json({ error: 'Status, notes, and verifiedBy are required' })
    }
    // Update document status
    await pool.query(
      'UPDATE documents SET status = ? WHERE id = ?',
      [status, req.params.id]
    )

    // Insert verification details
    await pool.query(
      'INSERT INTO verification_details (documentId, status, notes, verifiedBy) VALUES (?, ?, ?, ?)',
      [req.params.id, status, notes, verifiedBy]
    )

    const [updatedDoc] = await pool.query('SELECT * FROM documents WHERE id = ?', [req.params.id])
    res.json(updatedDoc[0])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})
app.get('/api/cofodocuments/:id/verify', async (req, res) => {
  try {
    const [verificationDetails] = await pool.query(
      'SELECT * FROM verification_details WHERE documentId = ?',
      [req.params.id]
    )
    if (!verificationDetails[0]) return res.status(404).json({ error: 'Verification details not found' })
    res.json(verificationDetails[0])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.put('/api/cofodocuments/:id/verify', async (req, res) => {
  try {
    await pool.query(
      'UPDATE verification_details SET ? WHERE documentId = ?',
      [req.body, req.params.id]
    )
    const [verificationDetails] = await pool.query(
      'SELECT * FROM verification_details WHERE documentId = ?',
      [req.params.id]
    )
    if (!verificationDetails[0]) return res.status(404).json({ error: 'Verification details not found' })
    res.json(verificationDetails[0])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.delete('/api/cofodocuments/:id/verify', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM verification_details WHERE documentId = ?', [req.params.id])
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Verification details not found' })
    res.status(204).send()
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

const PORT = process.env.PORT || 10000
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

// Package.json dependencies:
/*
{
  "dependencies": {
    "express": "^4.17.1",
    "mysql2": "^2.3.0",
    "multer": "^1.4.3",
    "node-tesseract-ocr": "^2.2.1",
    "dotenv": "^10.0.0",
    "cors": "^2.8.5"
  }
}
*/