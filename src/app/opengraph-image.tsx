import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "TextText, folders of Markdown for publishing";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default async function Image() {
  const [fraunces, interRegular, interSemiBold] = await Promise.all([
    readFile(join(process.cwd(), "public", "fonts", "Fraunces-SemiBold.ttf")),
    readFile(join(process.cwd(), "public", "fonts", "Inter-Regular.ttf")),
    readFile(join(process.cwd(), "public", "fonts", "Inter-SemiBold.ttf")),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "stretch",
          background: "#f8f5ee",
          color: "#181510",
          display: "flex",
          height: "100%",
          padding: 54,
          width: "100%",
        }}
      >
        <div
          style={{
            border: "1px solid #d9d2c7",
            display: "flex",
            flex: 1,
            position: "relative",
          }}
        >
          <div
            style={{
              background: "#065ec6",
              height: 3,
              left: 48,
              position: "absolute",
              right: 48,
              top: 46,
            }}
          />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              padding: "76px 62px 64px",
              width: 700,
            }}
          >
            <div
              style={{
                color: "#5d5548",
                fontFamily: "Inter",
                fontSize: 24,
                fontWeight: 600,
                letterSpacing: 0,
                lineHeight: 1.2,
                marginBottom: 28,
              }}
            >
              TextText
            </div>
            <div
              style={{
                display: "flex",
                fontFamily: "Fraunces",
                fontSize: 108,
                letterSpacing: 0,
                lineHeight: 0.92,
                marginBottom: 28,
                maxWidth: 560,
              }}
            >
              Folders of Markdown.
            </div>
            <div
              style={{
                color: "#424245",
                display: "flex",
                fontFamily: "Inter",
                fontSize: 34,
                fontWeight: 400,
                letterSpacing: 0,
                lineHeight: 1.25,
                maxWidth: 560,
              }}
            >
              A calm publishing home for writers and agents.
            </div>
          </div>
          <div
            style={{
              background: "#1d1d1f",
              color: "#ffffff",
              display: "flex",
              flex: 1,
              flexDirection: "column",
              justifyContent: "space-between",
              padding: "52px 48px",
            }}
          >
            <div
              style={{
                alignItems: "center",
                background: "#f8f5ee",
                border: "1px solid #d9d2c7",
                borderRadius: 22,
                color: "#181510",
                display: "flex",
                height: 118,
                justifyContent: "center",
                position: "relative",
                width: 118,
              }}
            >
              <div
                style={{
                  background: "#065ec6",
                  borderRadius: 2,
                  bottom: 22,
                  height: 5,
                  left: 26,
                  position: "absolute",
                  right: 26,
                }}
              />
              <div
                style={{
                  display: "flex",
                  fontFamily: "Fraunces",
                  fontSize: 74,
                  letterSpacing: 0,
                  lineHeight: 1,
                  marginTop: -8,
                }}
              >
                W
              </div>
            </div>
            <div
              style={{
                borderTop: "1px solid #3a3a3c",
                display: "flex",
                flexDirection: "column",
                gap: 18,
                paddingTop: 34,
              }}
            >
              {["Portable files", "Quiet publishing", "Agent-ready sync"].map(
                (label) => (
                  <div
                    key={label}
                    style={{
                      alignItems: "center",
                      display: "flex",
                      fontFamily: "Inter",
                      fontSize: 27,
                      fontWeight: 600,
                      gap: 14,
                      letterSpacing: 0,
                      lineHeight: 1.2,
                    }}
                  >
                    <span
                      style={{
                        background: "#065ec6",
                        borderRadius: 999,
                        display: "flex",
                        height: 9,
                        width: 9,
                      }}
                    />
                    {label}
                  </div>
                ),
              )}
            </div>
          </div>
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
        {
          name: "Inter",
          data: interRegular,
          style: "normal",
          weight: 400,
        },
        {
          name: "Inter",
          data: interSemiBold,
          style: "normal",
          weight: 600,
        },
      ],
    },
  );
}
