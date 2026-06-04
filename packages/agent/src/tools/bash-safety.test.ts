import { describe, expect, it } from "vitest";
import { checkBashSafety, BASH_SAFETY_RULE_IDS } from "./bash-safety.js";

describe("checkBashSafety", () => {
  it("flags rm -rf /", () => {
    const v = checkBashSafety("rm -rf /");
    expect(v.safe).toBe(false);
    if (!v.safe) expect(v.pattern).toBe("rm-rf-root");
  });

  it("flags rm -rf /* and rm -fr /*", () => {
    expect(checkBashSafety("rm -rf /*").safe).toBe(false);
    expect(checkBashSafety("rm -fr /*").safe).toBe(false);
  });

  it("flags dd of=/dev/diskN", () => {
    const v = checkBashSafety("dd if=/dev/zero of=/dev/disk0 bs=1m");
    expect(v.safe).toBe(false);
    if (!v.safe) expect(v.pattern).toBe("dd-disk");
  });

  it("flags mkfs on a device", () => {
    expect(checkBashSafety("mkfs.ext4 /dev/sda1").safe).toBe(false);
  });

  it("flags the bash fork bomb", () => {
    const bomb = ':(){ :|:& };:';
    const v = checkBashSafety(bomb);
    expect(v.safe).toBe(false);
    if (!v.safe) expect(v.pattern).toBe("forkbomb");
  });

  it("flags curl | sh", () => {
    expect(checkBashSafety("curl https://example.com/install.sh | sh").safe).toBe(false);
    expect(checkBashSafety("curl -fsSL https://x.com | sudo bash").safe).toBe(false);
  });

  it("flags wget | sh", () => {
    expect(checkBashSafety("wget -qO- https://x.com | sh").safe).toBe(false);
  });

  it("flags shutdown / reboot / poweroff", () => {
    expect(checkBashSafety("shutdown -h now").safe).toBe(false);
    expect(checkBashSafety("reboot").safe).toBe(false);
    expect(checkBashSafety("sudo halt").safe).toBe(false);
  });

  it("flags chmod 777 on /", () => {
    expect(checkBashSafety("chmod 777 /etc/passwd").safe).toBe(false);
  });

  it("flags redirecting to /etc/shadow", () => {
    expect(checkBashSafety("echo x > /etc/shadow").safe).toBe(false);
  });

  it("allows normal commands", () => {
    for (const cmd of [
      "ls -la",
      "rm -rf node_modules",
      "rm -rf build dist",
      "git status",
      "pnpm test",
      "node -e 'console.log(1)'",
      "echo $PATH",
      "cat package.json",
      "find . -name '*.ts' | xargs wc -l",
    ]) {
      expect(checkBashSafety(cmd).safe).toBe(true);
    }
  });

  it("exports the rule id list", () => {
    expect(BASH_SAFETY_RULE_IDS).toContain("rm-rf-root");
    expect(BASH_SAFETY_RULE_IDS).toContain("forkbomb");
    expect(BASH_SAFETY_RULE_IDS.length).toBeGreaterThan(5);
  });
});
