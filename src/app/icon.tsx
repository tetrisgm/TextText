import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const size = {
  width: 64,
  height: 64,
};

export const contentType = "image/png";

export default async function Icon() {
  const fraunces = await readFile(
    join(process.cwd(), "public", "fonts", "Fraunces-SemiBold.ttf"),
  );

  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#dcecff",
          border: "1px solid #b8d2ed",
          borderRadius: 14,
          color: "#181510",
          display: "flex",
          height: "100%",
          justifyContent: "center",
          position: "relative",
          width: "100%",
        }}
      >
        <div style={{ display: "flex", fontFamily: "Apple Color Emoji", fontSize: 40, lineHeight: 1 }}>📰</div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Fraunces",
          data: fraunces,
          style: "normal",
          weight: 600,
        },
      ],
    },
  );
}
