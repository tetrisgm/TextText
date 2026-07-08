import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default async function AppleIcon() {
  const fraunces = await readFile(
    join(process.cwd(), "public", "fonts", "Fraunces-SemiBold.ttf"),
  );

  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#f8f5ee",
          border: "1px solid #d9d2c7",
          borderRadius: 40,
          color: "#181510",
          display: "flex",
          height: "100%",
          justifyContent: "center",
          position: "relative",
          width: "100%",
        }}
      >
        <div
          style={{
            background: "#065ec6",
            borderRadius: 4,
            bottom: 31,
            height: 8,
            left: 42,
            position: "absolute",
            right: 42,
          }}
        />
        <div
          style={{
            display: "flex",
            fontFamily: "Fraunces",
            fontSize: 116,
            letterSpacing: 0,
            lineHeight: 1,
            marginTop: -11,
          }}
        >
          W
        </div>
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
