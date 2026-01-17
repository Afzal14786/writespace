import fs from "fs";
import path from "path";
import swaggerSpec from "../config/swagger";

const OUTPUT_FILE = path.join(__dirname, "../../dist/swagger.json");

try {
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(swaggerSpec, null, 2));
  console.log(`Swagger documentation generated successfully at ${OUTPUT_FILE}`);
} catch (err) {
  console.error("Error generating swagger documentation:", err);
  process.exit(1);
}
