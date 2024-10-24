import express from "express";
import { body, query } from "express-validator";
import { db } from "../db/database.js";
import { isAuth, validate } from "../middleware/functions.js";

const router = express.Router();

// 태그 구분 등록
router.post(
  "/tag-type",
  isAuth,
  [
    body("name").trim().notEmpty().withMessage("태그 구분명을 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    const { name } = req.body;
    if (name === "기본") {
      res.status(409).json({ message: "'기본'은 사용할 수 없습니다." });
      return;
    }
    // console.log("데이터", name);
    try {
      const foundType = await db
        .execute(
          `SELECT name FROM tag_type WHERE user_idx=${req.authorizedUser} AND name != '기본'`
        )
        .then((result) => {
          result = result[0];
          if (result) {
            result = result.reduce((acc, cur) => {
              acc.push(cur.name);
              return acc;
            }, []);
            return result;
          }
          return;
        });
      // console.log("foundType", foundType);
      if (foundType.includes(name)) {
        res.status(409).json({ message: "태그 구분명이 중복됩니다." });
        return;
      }
      if (foundType.length >= 5) {
        res
          .status(409)
          .json({ message: "태그 구분은 기본을 제외한 5개까지 허용됩니다." });
        return;
      }

      const result = await db.execute(
        "INSERT INTO tag_type (user_idx, name) VALUES (?,?)",
        [req.authorizedUser, name]
      );
      // console.log("리턴", result[0].insertId);
      res.status(201).json({ idx: result[0].insertId });
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 태그 구분 목록
router.get("/tag-type-all", isAuth, async (req, res) => {
  try {
    let { type_idx, user_idx } = req.query;
    user_idx = req.authorizedUser == 1 ? user_idx : req.authorizedUser;

    let where,
      addDefault = true;
    let list;
    if (type_idx == null || type_idx === "") {
      list = await db
        .query(
          `SELECT T.idx, T.user_idx, T.name, TT.idx AS tag_type_idx, TT.name AS tag_type_name, T.created_time
     FROM (SELECT * FROM tag_type WHERE user_idx = ${user_idx}) AS TT                         
     LEFT JOIN tag AS T
     ON T.tag_type_idx = TT.idx
     ORDER BY tag_type_idx ASC, idx ASC;`
        )
        .then((result) => result[0]);
    } else {
      if (type_idx === 0) {
        where = `WHERE TT.name = '기본'`;
      } else {
        where = `WHERE TT.idx = ${type_idx}`;
        addDefault = false;
      }
      list = await db
        .query(
          `SELECT T.idx, T.user_idx, T.name, TT.idx AS tag_type_idx, TT.name AS tag_type_name, T.created_time
       FROM (SELECT * FROM tag_type WHERE user_idx = ${user_idx} )AS TT
       LEFT JOIN tag AS T
       ON T.tag_type_idx = TT.idx
       ${where}
       ORDER BY TT.idx ASC, idx ASC;`
        )
        .then((result) => result[0]);
    }

    // console.log(list, where);

    // 결과 정리
    let tag_types = {};
    let defaultType;
    for (let cur of list) {
      const idx = cur.tag_type_idx;
      const name = cur.tag_type_name;

      // 기본은 따로 빼두고
      if (addDefault && name == "기본") {
        if (!defaultType) defaultType = { idx, name: "기본", tags: [] };
        if (cur.idx) {
          defaultType.tags.push({ idx: cur.idx, name: cur.name });
        }
      } else {
        if (!tag_types[idx]) {
          tag_types[idx] = { idx, name, tags: [] };
        }
        if (cur.idx) {
          tag_types[idx].tags.push({ idx: cur.idx, name: cur.name });
        }
      }
    }

    // 기본을 맨 위로
    if (addDefault && defaultType)
      tag_types = [defaultType, ...Object.values(tag_types)];

    // console.log("result", JSON.stringify(tag_types, null, 2));
    res.status(200).json(tag_types);
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

// 태그 구분 선택 삭제
router.post(
  "/tag-type-delete",
  isAuth,
  [
    body("idx").trim().notEmpty().withMessage("태그 타입 idx를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const idx = req.body.idx;
      const tag_type = await db
        .execute(
          `SELECT name FROM tag_type WHERE idx = ${idx} AND user_idx = ${req.authorizedUser}`
        )
        .then((result) => result[0][0]);
      if (!tag_type) {
        res
          .status(404)
          .json({ message: "해당 태그 구분이 존재하지 않습니다." });
        return;
      }
      if (tag_type.name == "기본") {
        res
          .status(409)
          .json({ message: "기본 태그 구분은 삭제할 수 없습니다." });
        return;
      }
      const existTags = await db
        .execute(`SELECT idx FROM tag WHERE tag_type_idx = ${idx}`)
        .then((result) => result[0]);

      if (existTags.length > 0) {
        res
          .status(409)
          .json({ message: "해당 태그 구분에 태그가 존재합니다다" });
        return;
      }

      await db.execute(`DELETE FROM tag_type WHERE idx=${idx}`);

      res.sendStatus(204);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 태그 등록
router.post(
  "/tag",
  isAuth,
  [
    body("name").trim().notEmpty().withMessage("태그 이름을 입력해 주세요."),
    body("tag_type_idx")
      .trim()
      .notEmpty()
      .withMessage("태그 구분 idx 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { name, tag_type_idx } = req.body;
      const user_idx =
        req.authorizedUser === 1 ? req.body.user_idx : req.authorizedUser;
      const existTagType = await db
        .execute(
          `SELECT name FROM tag_type WHERE user_idx=${user_idx} && idx=${tag_type_idx}`
        )
        .then((result) => result[0][0]);

      if (!existTagType) {
        res.status(404).json({ message: "태그 구분이 존재하지 않습니다." });
        return;
      }
      if (existTagType.name == "기본") {
        res
          .status(409)
          .json({ message: "기본 태그 구분에는 추가가 불가합니다." });
        return;
      }

      const tagCount = await db
        .execute(
          `SELECT count(idx) AS total FROM tag WHERE user_idx=${user_idx} && is_default=0`
        )
        .then((result) => result[0][0].total);
      if (tagCount >= 50) {
        res.status(409).json({ message: "태그는 50개를 넘을 수 없습니다." });
        return;
      }

      const existTag = await db
        .execute(
          `SELECT idx FROM tag WHERE user_idx=${user_idx} && name='${name}'`
        )
        .then((result) => result[0][0]);
      if (existTag) {
        res.status(409).json({ message: "이미 사용중인 태그명입니다." });
        return;
      }

      const result = await db.execute(
        `INSERT INTO tag (user_idx, name, is_default, tag_type_idx) VALUES (?,?,?,?)`,
        [user_idx, name, 0, tag_type_idx]
      );

      res.status(201).json({ idx: result[0].insertId });
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 태그 삭제
router.post(
  "/tag-delete",
  isAuth,
  [
    body("idx").trim().notEmpty().withMessage("태그 idx 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { idx } = req.body;
      const existTag = await db
        .execute(
          `SELECT name FROM tag WHERE user_idx=${req.authorizedUser} && idx=${idx} && is_default=0`
        )
        .then((result) => result[0][0]);

      if (!existTag) {
        res.status(404).json({ message: "태그가 존재하지 않습니다." });
        return;
      }

      await db.execute(`DELETE FROM tag_to_customer WHERE tag_idx = ${idx}`);
      await db.execute(`DELETE FROM tag WHERE idx = ${idx}`);

      res.sendStatus(204);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

router.get(
  "/tag",
  isAuth,
  [
    query("name").trim().notEmpty().withMessage("태그명을 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { name } = req.query;
      const user_idx =
        req.authorizedUser === 1 ? req.query.user_idx : req.authorizedUser;
      const tag = await db
        .execute(
          `SELECT idx, name, is_default FROM tag WHERE user_idx=${user_idx} && name='${name}'`
        )
        .then((result) => result[0][0]);
      if (!tag) {
        res.status(404).json({ message: "태그가 존재하지 않습니다." });
        return;
      }
      res.status(200).json(tag);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

router.post(
  "/tag-not-dup",
  isAuth,
  [
    body("name").trim().notEmpty().withMessage("태그명을 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      let { name, user_idx } = req.body;
      user_idx = req.authorizedUser == 1 ? user_idx : req.authorizedUser;
      const exist = await db
        .query(
          `SELECT idx FROM tag WHERE user_idx = ${user_idx} AND name = '${name}'`
        )
        .then((r) => r[0][0]);

      if (exist) {
        res
          .status(409)
          .json({ ok: false, message: "중복된 태그가 존재합니다." });
        return;
      }
      res.status(200).json({ ok: true });
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

export default router;
