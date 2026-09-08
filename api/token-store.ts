import fs from "fs";
import path from "path";

const TOKEN_FILE = path.join(process.cwd(), "auth_tokens.json");

export function getStoredRefreshToken(): string | null {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
      if (data && data.refresh_token) {
        return data.refresh_token;
      }
    }
  } catch (err) {
    console.error("Error reading stored refresh token:", err);
  }
  return null;
}

export function setStoredRefreshToken(refreshToken: string): void {
  try {
    fs.writeFileSync(
      TOKEN_FILE,
      JSON.stringify(
        {
          refresh_token: refreshToken,
          updated_at: new Date().toISOString(),
        },
        null,
        2
      ),
      "utf-8"
    );
    console.log("Successfully persisted updated refresh token to auth_tokens.json");
  } catch (err) {
    console.error("Error saving refresh token to disk:", err);
  }
}
