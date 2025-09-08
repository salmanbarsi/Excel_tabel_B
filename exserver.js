const express = require("express");
const multer = require("multer");
const cors = require("cors");
const readXlsxFile = require("read-excel-file/node");
const { neon } = require("@neondatabase/serverless");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const sql = neon(process.env.DATABASE_URL);
const app = express();
app.use(cors());
app.use(express.json());


const uploadPath = path.join(__dirname, "files");
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath);
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    cb(null, `${file.originalname}`);
  },
});
const upload = multer({ storage });


app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const filePath = req.file.path;
    const tableName = path
      .basename(req.file.originalname, path.extname(req.file.originalname))
      .toLowerCase();

    const rows = await readXlsxFile(filePath);
    const headers = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, "_"));
    const dataRows = rows.slice(1);


    const columnsSQL = headers.map((h) => `"${h}" TEXT`).join(", ");
    await sql.query(`CREATE TABLE IF NOT EXISTS "${tableName}" (${columnsSQL})`);


    for (let row of dataRows) {
      const values = row.map((v) =>
        v instanceof Date ? v.toISOString().split("T")[0] : v
      );
      const cols = headers.map((h) => `"${h}"`).join(", ");
      const placeholders = headers.map((_, i) => `$${i + 1}`).join(", ");
      await sql.query(
        `INSERT INTO "${tableName}" (${cols}) VALUES (${placeholders})`,
        values
      );
    }

    res.json({
      message: "File uploaded & data inserted",
      table: tableName,
      file: req.file.filename,
    });
  } 
  catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});


app.get("/db-files", async (req, res) => {
  try {
    const result = await sql.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
    );
    res.json(result)
  }
  catch (err) {
    res.status(500).json({ error: "Failed to fetch tables" });
  }
});


app.get("/data/:tableName", async (req, res) => {
  const { tableName } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;

  try {
    const totalResult = await sql.query(`SELECT COUNT(*) FROM "${tableName}"`);
    const total = parseInt(totalResult[0].count);

    const colResult = await sql.query(
      `SELECT column_name 
       FROM information_schema.columns 
       WHERE table_name = $1 
       ORDER BY ordinal_position ASC 
       LIMIT 1`,
      [tableName]
    );
    const id = colResult[0].column_name;
    // console.log(id)
 
    const data = await sql.query(
      `SELECT * FROM "${tableName}" ORDER BY "${id}" ASC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({data, page, limit, total, totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("Fetch error:", err);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});


app.delete("/db-files/:tableName", async (req, res) => {
  const { tableName } = req.params;
  try {
    await sql.query(`DROP TABLE IF EXISTS "${tableName}"`);

    const files = fs.readdirSync(uploadPath);
    const match = files.find((f) =>f.toLowerCase().includes(tableName.toLowerCase()));
    if (match) {
      fs.unlinkSync(path.join(uploadPath, match));
    }

    res.json({ message: `Table '${tableName}' and file deleted` });
  } 
  catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ error: "Failed to delete table/file" });
  }
});

app.put("/data/:tableName/:recordId", async (req, res) => {
  const { tableName, recordId } = req.params;
  const updatedData = req.body;

  try {
    if (!tableName || !recordId) {
      return res.status(400).json({ error: "Table name or record ID missing" });
    }

    const columns = Object.keys(updatedData);
    const values = Object.values(updatedData);

    if (!columns.length) {
      return res.status(400).json({ error: "No data provided to update" });
    }

    // console.log("Update result:", columns[0]);

    const idColumn = columns[0];
    

    const setClause = columns.map((col, idx) => `"${col}"=$${idx + 1}`).join(", ");
    const query = `UPDATE "${tableName}" SET ${setClause} WHERE "${idColumn}"=$${columns.length + 1} RETURNING *;`;

    const result = await sql.query(query, [...values, recordId]);
    console.log("Update result:", result);

    if (!result || !result.length) {
      return res.status(404).json({ error: "Record not found" });
    }

    res.json({ message: "Record updated successfully", data: result[0] });
  } catch (err) {
    console.error("Update error:", err);
    res.status(500).json({ error: "Failed to update table row" });
  }
});



app.listen(2000, () => {
  console.log("🚀 Server running on port 2000");
});
