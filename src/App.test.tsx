import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("Keyloom application shell", () => {
  it("renders all primary navigation destinations", () => {
    render(<App />);

    for (const label of ["概览", "供应商", "模型路由", "活动", "集成", "设置"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });
});
