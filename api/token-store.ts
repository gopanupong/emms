import fs from "fs";
import path from "path";
import os from "os";

let inMemoryRefreshToken: string | null = null;
const TOKEN_FILE = path.join(os.tmpdir(), "auth_tokens.json");

export function getStoredRefreshToken(): string | null {
  if (inMemoryRefreshToken) {
    return inMemoryRefreshToken;
  }
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
      if (data && data.refresh_token) {
        inMemoryRefreshToken = data.refresh_token;
        return inMemoryRefreshToken;
      }
    }
  } catch (err) {
    console.error("Error reading stored refresh token:", err);
  }
  return null;
}

export function setStoredRefreshToken(refreshToken: string): void {
  inMemoryRefreshToken = refreshToken;
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
    console.log("Successfully persisted updated refresh token to tmp auth_tokens.json");
  } catch (err) {
    console.error("Error saving refresh token to disk:", err);
  }
}
