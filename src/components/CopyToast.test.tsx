import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCopyToast } from "./CopyToast";

function ToastHarness() {
  const { copyToast, showCopyToast } = useCopyToast();
  return <><button type="button" onClick={() => showCopyToast("已复制")}>复制</button>{copyToast}</>;
}

describe("copy toast", () => {
  afterEach(() => vi.useRealTimers());

  it("restarts and automatically disappears after a copy", () => {
    vi.useFakeTimers();
    render(<ToastHarness />);

    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    expect(screen.getByRole("status")).toHaveTextContent("已复制");

    act(() => vi.advanceTimersByTime(1_000));
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(801));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
