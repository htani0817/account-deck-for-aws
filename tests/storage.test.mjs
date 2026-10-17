import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLib } from "./helpers.mjs";

test("buildSwitchRoleUrl は v1 と同じURLを作る", () => {
  const { get } = loadLib();
  const url = get("buildSwitchRoleUrl")({
    accountId: "1234-5678-9012",
    roleName: "AdministratorRole",
    displayName: "本番環境",
    color: "#f2b0a9",
  });
  // v1: account はハイフンを外し、color は # を外す
  assert.equal(
    url,
    "https://signin.aws.amazon.com/switchrole?account=123456789012&roleName=AdministratorRole&displayName=%E6%9C%AC%E7%95%AA%E7%92%B0%E5%A2%83&color=f2b0a9"
  );
});

test("アカウントIDは12桁の数字とエイリアスを受け付ける", () => {
  const { get } = loadLib();
  const normalize = get("normalizeAccountId");
  const valid = get("isValidAccountId");
  const format = get("formatAccountId");

  assert.equal(normalize(" 1234-5678 9012 "), "123456789012");
  assert.equal(normalize("My-Company"), "my-company");
  assert.ok(valid("123456789012"));
  assert.ok(valid("my-company"));
  assert.ok(!valid("12345"));
  assert.ok(!valid("-bad-"));
  assert.ok(!valid("has space"));
  assert.equal(format("123456789012"), "1234-5678-9012");
  assert.equal(format("my-company"), "my-company");
  assert.equal(get("defaultLoginUrl")("1234-5678-9012"), "https://123456789012.signin.aws.amazon.com/console");
});

test("検索はハイフンの有無に関係なくアカウントIDに一致する", () => {
  const { get } = loadLib();
  const matches = get("itemMatches");
  const item = { displayName: "本番", accountId: "123456789012", roleName: "Admin", label: "PROD" };
  assert.ok(matches(item, "5678-9012"));
  assert.ok(matches(item, "prod"));
  assert.ok(matches(item, "admin"));
  assert.ok(!matches(item, "staging"));
});

test("取り込み時に https 以外のURLや必須項目の欠けた項目を捨てる", () => {
  const { get } = loadLib();
  const sanitize = get("sanitizeItem");
  const now = 1;
  assert.equal(sanitize({ type: "login", displayName: "x", accountId: "123456789012", url: "javascript:alert(1)" }, now).url, "");
  assert.equal(sanitize({ type: "login", displayName: "", accountId: "123456789012" }, now), null);
  assert.equal(sanitize({ type: "switchRole", displayName: "x", accountId: "123456789012" }, now), null);
  assert.equal(sanitize({ type: "other", displayName: "x", accountId: "1" }, now), null);
  const ok = sanitize({ type: "login", displayName: "x", accountId: "1234-5678-9012", color: "#abc", label: "123456789" }, now);
  assert.equal(ok.accountId, "123456789012");
  assert.equal(ok.color, "#AABBCC");
  assert.equal(ok.label, "12345678");
});

test("moveItemTo は指定した項目の前後へ移す", () => {
  const { get } = loadLib();
  const move = get("moveItemTo");
  const ids = (list) => list.map((i) => i.id).join("");
  const items = ["a", "b", "c", "d"].map((id) => ({ id }));
  assert.equal(ids(move(items, "d", "b", false)), "adbc");
  assert.equal(ids(move(items, "a", "c", true)), "bcad");
  assert.equal(ids(move(items, "a", "a", true)), "abcd");
});
