import { describe, expect, it } from "vitest";
import { noTheme, fromPiTheme } from "../src/tui/dashboard-theme.ts";

describe("DashboardTheme", () => {
  describe("noTheme", () => {
    it("inverse returns text unchanged", () => {
      expect(noTheme.inverse("hello")).toBe("hello");
    });

    it("bg returns text unchanged", () => {
      expect(noTheme.bg("selectedBg", "hello")).toBe("hello");
    });
  });

  describe("fromPiTheme", () => {
    const piTheme = {
      fg: (_color: string, text: string) => text,
      bold: (text: string) => `<b>${text}</b>`,
      inverse: (text: string) => `<inv>${text}</inv>`,
      bg: (color: string, text: string) => `<bg:${color}>${text}</bg>`,
    };

    it("delegates inverse to theme.inverse", () => {
      const theme = fromPiTheme(piTheme as never);
      expect(theme.inverse("test")).toBe("<inv>test</inv>");
    });

    it("delegates bg to theme.bg", () => {
      const theme = fromPiTheme(piTheme as never);
      expect(theme.bg("selectedBg", "test")).toBe("<bg:selectedBg>test</bg>");
    });
  });
});
