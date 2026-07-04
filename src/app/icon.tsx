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
          background: "#f8f5ee",
          border: "1px solid #d9d2c7",
          borderRadius: 14,
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
            borderRadius: 2,
            bottom: 10,
            height: 3,
            left: 14,
            position: "absolute",
            right: 14,
          }}
        />
        <div
          style={{
            display: "flex",
            fontFamily: "Fraunces",
            fontSize: 42,
            letterSpacing: 0,
            lineHeight: 1,
            marginTop: -4,
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
