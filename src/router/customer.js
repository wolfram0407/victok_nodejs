import dayjs from "dayjs";
import express from "express";
import { body, query } from "express-validator";
import { db } from "../db/database.js";
import {
  addTagToCustomer,
  isAdminAuth,
  isAuth,
  removeTagToCustomer,
  validate,
} from "../middleware/functions.js";

const router = express.Router();

router.get("/customer-names", isAuth, async (req, res) => {
  try {
    const user_idx =
      req.authorizedUser === 1 ? req.query.user_idx : req.authorizedUser;
    const list = await db
      .query(
        `SELECT name, phone FROM customer WHERE user_idx = ${user_idx} AND deleted_time IS NULL`
      )
      .then((r) => r[0]);
    res.status(200).json(list);
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

// 회원(customer) 등록
router.post(
  "/customer",
  isAuth,
  [
    body("customer_name")
      .trim()
      .notEmpty()
      .withMessage("사용자 이름을 입력해 주세요."),
    body("customer_phone")
      .trim()
      .notEmpty()
      .withMessage("사용자 휴대폰 번호를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const {
        customer_name,
        customer_phone,
        gender = null,
        birth = null,
        memo = null,
        user_idx,
        tags,
        agree_marketing,
      } = req.body;

      const existPhone = await db
        .execute(
          `SELECT idx FROM customer WHERE user_idx=${
            user_idx ? user_idx : req.authorizedUser
          }&&phone='${customer_phone}'&&deleted_time IS NULL`
        )
        .then((result) => result[0][0]);
      if (existPhone) {
        res.status(409).json({
          message: `${customer_phone} 번호를 가진 이용자가 존재합니다.`,
        });
        return;
      }

      const result = await db.execute(
        "INSERT INTO customer ( user_idx, name, phone, gender, birth, memo, created_time, agree_marketing) VALUES (?,?,?,?,?,?,?,?)",
        [
          user_idx ? user_idx : req.authorizedUser,
          customer_name,
          customer_phone,
          gender ? gender : null,
          birth ? birth : null,
          memo,
          new Date(),
          agree_marketing ?? 0,
        ]
      );
      const insertId = result[0].insertId;

      // 태그 연결
      if (tags?.length > 0 && insertId) {
        // 기본 태그 삽입
        const defaultTags = [];
        const otherTags = [];
        tags.forEach((tag) => {
          if (tag.is_default) {
            defaultTags.push(tag);
          } else {
            otherTags.push(tag);
          }
        });

        const defaultTagNames = defaultTags.map((t) => t.name);

        let defaultTagTypeIdx = await db
          .execute(
            `SELECT idx FROM tag_type WHERE user_idx=${req.authorizedUser} && name='기본'`
          )
          .then((r) => r[0][0]?.idx);
        if (!defaultTagTypeIdx) {
          defaultTagTypeIdx = await db
            .execute(`INSERT INTO tag_type (user_idx, name) VALUES (?,?)`, [
              req.authorizedUser,
              "기본",
            ])
            .then((r) => r[0].insertId);
        }

        await Promise.all(
          defaultTagNames.map((name) =>
            db.execute(
              `INSERT IGNORE INTO tag (user_idx, name, is_default, tag_type_idx) VALUES (?,?,?,?)`,
              [req.authorizedUser, name, 1, defaultTagTypeIdx]
            )
          )
        );

        // 넣어야할 기본 태그들 검색
        const defaultTagIdxs = await db
          .execute(
            `SELECT idx FROM tag WHERE user_idx = ${
              req.authorizedUser
            } && name IN (${defaultTagNames.map((t) => `'${t}'`).join(",")})`
          )
          .then((r) => r[0].map((t) => t.idx));
        const otherTagIdxs = otherTags.map((t) => t.idx);

        const tagIdxs = [...defaultTagIdxs, ...otherTagIdxs];

        await Promise.all(
          tagIdxs.map((tag_idx) =>
            db.execute(
              "INSERT IGNORE INTO tag_to_customer (tag_idx, customer_idx) VALUES (?,?)",
              [tag_idx, insertId]
            )
          )
        );
      }

      res.sendStatus(201);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 타 가맹점의 회원 포함 조회
router.get(
  "/customer-info-other",
  isAdminAuth,
  [
    query("customer_idx")
      .trim()
      .notEmpty()
      .withMessage("customer_idx를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { customer_idx } = req.query;
      const phone = await db
        .query(`SELECT phone FROM customer WHERE idx = ${customer_idx}`)
        .then((r) => r[0][0].phone);
      const list = await db
        .query(
          `SELECT 
        Main.idx AS customer_idx,
        store.name AS store_name,
        user.idx AS user_idx
      FROM
        (SELECT 
            idx, name, phone, user_idx
        FROM
            customer
        WHERE
            phone = '${phone}' AND deleted_time IS NULL) AS Main
      JOIN user ON Main.user_idx = user.idx
      JOIN store ON store.user_idx = user.idx
      ORDER BY Main.idx ASC
      `
        )
        .then((r) => r[0]);

      res.status(200).json(list);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 회원 정보
router.get(
  "/customer-info",
  isAuth,
  [
    query("customer_idx")
      .trim()
      .notEmpty()
      .withMessage("customer_idx를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { customer_idx } = req.query;
      let onlyMine = "";
      if (req.authorizedUser !== 1 && req.authorizedUser !== 100055) {
        onlyMine = `&& user_idx = ${req.authorizedUser}`;
      }

      const customerInfo = await db
        .execute(
          `SELECT idx, name, phone, gender, birth, memo, user_idx, agree_marketing FROM customer WHERE idx=${customer_idx} ${onlyMine}`
        )
        .then((result) => result[0][0]);

      if (!customerInfo) {
        res.status(404).json({ message: "해당 회원이 존재하지 않습니다." });
      }

      const tags = await db
        .execute(
          `SELECT idx, name, is_default 
      FROM tag AS T
      JOIN (SELECT * FROM tag_to_customer WHERE customer_idx = ${customer_idx}) AS TTC
      ON TTC.tag_idx = T.idx;`
        )
        .then((result) => result[0]);
      // console.log("회원정보", customerInfo);
      res.status(200).json({ ...customerInfo, tags });
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 회원 정보 수정
router.put(
  "/customer-info",
  isAuth,
  [
    body("customer_idx").notEmpty().withMessage("customer_idx 입력해 주세요."),
    body("name").notEmpty().withMessage("이름을 입력해 주세요."),
    body("phone").notEmpty().withMessage("휴대폰 번호를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const {
        customer_idx,
        name,
        phone,
        gender,
        birth,
        memo,
        user_idx,
        tags,
        agree_marketing,
      } = req.body;

      let userIdx = user_idx ? user_idx : req.authorizedUser;

      if (req.authorizedUser !== 1 && req.authorizedUser !== 100055) {
        if (
          (await db
            .query(`SELECT user_idx FROM customer WHERE idx=${customer_idx}`)
            .then((r) => r[0][0].user_idx)) !== req.authorizedUser
        ) {
          res.sendStatus(401);
          return;
        }
      }

      const original = await db
        .execute(
          `SELECT idx FROM customer WHERE idx=${customer_idx} && phone='${phone}'`
        )
        .then((result) => result[0][0]);
      const entries = Object.entries({
        name,
        phone,
        gender,
        birth: birth ? birth : null,
        memo,
        agree_marketing,
      }).filter(([_, v]) => v != null);
      if (original) {
        await db.execute(
          `UPDATE customer SET ${entries
            .map(([k]) => `${k}=?`)
            .join(", ")} WHERE idx=?&&deleted_time IS NULL`,
          [...entries.map(([_, v]) => v), customer_idx]
        );
      } else {
        const foundCustomer = await db
          .execute(
            `SELECT idx FROM customer WHERE user_idx=${userIdx} && phone='${phone}' && deleted_time IS NULL`
          )
          .then((result) => result[0][0]);
        if (foundCustomer) {
          console.log("foundCustomer", foundCustomer);
          res.status(409).json({
            message: `해당 가맹점에 ${phone} 번호를 가진 이용자가 존재합니다.`,
          });
        } else {
          await db.execute(
            `UPDATE customer SET ${entries
              .map(([k]) => `${k}=?`)
              .join(", ")} WHERE idx=?&&deleted_time IS NULL`,
            [...entries.map(([_, v]) => v), customer_idx]
          );
        }
      }

      // 태그 연결
      if (tags?.length > 0) {
        // 기본 태그 삽입
        const defaultTags = [];
        const otherTags = [];
        tags.forEach((tag) => {
          if (tag.is_default) {
            defaultTags.push(tag);
          } else {
            otherTags.push(tag);
          }
        });

        const defaultTagNames = defaultTags.map((t) => t.name);

        let defaultTagTypeIdx = await db
          .execute(
            `SELECT idx FROM tag_type WHERE user_idx=${userIdx} && name='기본'`
          )
          .then((r) => r[0][0].idx);
        if (!defaultTagTypeIdx) {
          defaultTagTypeIdx = await db
            .execute(`INSERT INTO (user_idx, name) VALUES (?,?)`, [
              userIdx,
              "기본",
            ])
            .then((r) => r[0].insertId);
        }

        await Promise.all(
          defaultTagNames.map((name) =>
            db.execute(
              `INSERT IGNORE INTO tag (user_idx, name, is_default, tag_type_idx) VALUES (?,?,?,?)`,
              [userIdx, name, 1, defaultTagTypeIdx]
            )
          )
        );

        // 넣어야할 기본 태그들 검색
        const defaultTagIdxs = await db
          .query(
            `SELECT idx FROM tag WHERE user_idx = ${userIdx} && name IN (${
              defaultTagNames.length > 0
                ? defaultTagNames.map((t) => `'${t}'`).join(",")
                : "''"
            })`
          )
          .then((r) => r[0].map((t) => t.idx));
        const otherTagIdxs = otherTags.map((t) => t.idx);

        const tagIdxs = [...defaultTagIdxs, ...otherTagIdxs];

        await Promise.all(
          tagIdxs.map((tag_idx) =>
            db.execute(
              "INSERT IGNORE INTO tag_to_customer (tag_idx, customer_idx) VALUES (?,?)",
              [tag_idx, customer_idx]
            )
          )
        );

        // tag_to_customer에서 새로 온 태그 이외엔 삭제
        await db.execute(`
        DELETE FROM tag_to_customer AS Main
        WHERE 
          customer_idx = ${customer_idx} 
          AND Main.tag_idx IN (
            SELECT idx
            FROM (SELECT idx, name FROM tag WHERE user_idx = ${userIdx} AND NOT name IN (${tags
          .map((t) => `'${t.name}'`)
          .join()})) AS T
            JOIN (
              SELECT *
              FROM tag_to_customer
              WHERE customer_idx = ${customer_idx}
            ) AS TTC ON T.idx = TTC.tag_idx
          )`);

        // tag에서 안쓰는 기본 태그들 정리
        await db.execute(`
        DELETE FROM tag AS Main
        WHERE 
          Main.idx IN (SELECT T.idx
          FROM (SELECT idx FROM tag WHERE user_idx = ${userIdx} AND is_default = 1) AS T
          LEFT JOIN tag_to_customer AS TTC ON T.idx = TTC.tag_idx
          WHERE customer_idx IS NULL)
        `);
      }

      res.sendStatus(204);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 회원 선택 삭제
router.post(
  "/customer-delete",
  isAuth,
  [
    body("idx")
      .isLength({ min: 1 })
      .withMessage("customer_idx를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const idxs = req.body.idx.split(",");
      console.log(idxs);
      for (const idx of idxs) {
        console.log("현", idx);
        const foundLocker = await db
          .execute(
            `SELECT * FROM (SELECT Max(locker.idx) as idx FROM locker WHERE locker_type IN (SELECT locker_type FROM locker WHERE customer_idx=${idx}&&deleted_time IS NULL GROUP BY locker_type, locker_number) && locker_number IN (SELECT locker_number FROM locker WHERE customer_idx =${idx}&&deleted_time IS NULL GROUP BY locker_type, locker_number) group by locker_type,locker_number) idx JOIN locker on idx.idx = locker.idx WHERE locker.customer_idx=${idx}`
          )
          .then((result) => result[0]);

        if (foundLocker.length > 0) {
          return res.status(409).json({
            message: "라커를 이용하고 있는 회원은 삭제할 수 없습니다.",
          });
        }
      }
      await db.execute(
        `UPDATE customer SET deleted_time=? WHERE idx IN(${idxs})`,
        [new Date()]
      );

      res.sendStatus(204);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 지공차트 등록
router.post(
  "/drilling-chart",
  isAuth,
  [
    body("customer_idx").notEmpty().withMessage("회원 idx를 입력해 주세요."),
    body("ball_name").notEmpty().withMessage("볼 이름을 입력해 주세요."),
    body("weight").notEmpty().withMessage("무게를 입력해 주세요."),
    body("driller_idx").notEmpty().withMessage("지공사를 선택해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const {
        title,
        customer_idx,
        chart_data,
        ball_name,
        weight,
        driller_idx,
        hand,
        layout,
        pin,
        memo,
        user_idx,
      } = req.body;
      // console.log("chart_data", req.body);
      const foundChartNumber = await db
        .execute(
          `SELECT chart_number FROM drilling_chart WHERE customer_idx=${customer_idx} ORDER BY idx DESC`
        )
        .then((result) =>
          result[0].length > 0 ? result[0][0].chart_number : 0
        );
      // console.log("마ㅣㅈ지막 넘버", foundChartNumber);
      await db.execute(
        "INSERT INTO drilling_chart ( user_idx, customer_idx, chart_number, chart_name, chart_data, ball_name, weight, driller_idx, hand, layout, pin, memo, created_time, updated_time ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          user_idx ? user_idx : req.authorizedUser,
          customer_idx,
          foundChartNumber ? foundChartNumber + 1 : 1,
          title
            ? title
            : `지공차트${foundChartNumber ? foundChartNumber + 1 : 1}`,
          chart_data.join(","),
          ball_name,
          weight,
          driller_idx,
          hand ?? "",
          layout ?? "",
          pin ?? "",
          memo ?? "",
          new Date(),
          null,
        ]
      );

      await addTagToCustomer({
        tagName: "지공차트이용",
        customer_idx,
        user_idx: user_idx ? user_idx : req.authorizedUser,
      });

      await removeTagToCustomer({
        tagName: "지공차트미이용",
        customer_idx,
        user_idx: user_idx ? user_idx : req.authorizedUser,
      });

      res.sendStatus(201);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 지공차트 목록
router.get(
  "/drilling-chart-list",
  isAuth,
  [
    query("customer_idx").notEmpty().withMessage("회원 idx를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { customer_idx, page } = req.query;
      console.log(req.body);
      const amount = req.query.amount ?? 10;
      const total = await db
        .execute(
          `SELECT COUNT(idx) AS total FROM drilling_chart WHERE customer_idx=${customer_idx}&&deleted_time IS NULL`
        )
        .then((result) => result[0][0].total);
      const chartList = await db
        .execute(
          `SELECT drilling_chart.idx, drilling_chart.customer_idx, drilling_chart.chart_number,drilling_chart.chart_name, drilling_chart.ball_name, drilling_chart.weight, drilling_chart.layout, drilling_chart.pin, driller.name AS driller, drilling_chart.memo, drilling_chart.created_time, drilling_chart.updated_time FROM drilling_chart JOIN driller ON drilling_chart.driller_idx=driller.idx WHERE drilling_chart.customer_idx=${customer_idx}&&drilling_chart.deleted_time IS NULL ORDER BY idx DESC LIMIT ${amount} OFFSET ${
            amount * (page - 1)
          }`
        )
        .then((result) => result[0]);
      // console.log("데이터", chartList, "토탈", total);
      res.status(200).json({ total, chartList });
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 지공차트 상세 & 회원 정보
router.get(
  "/drilling-chart",
  isAuth,
  [
    query("idx").trim().notEmpty().withMessage("차트 idx를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    const { idx } = req.query;
    const chartDetails = await db
      .execute(
        `SELECT customer.name as name, customer.phone as phone, drilling_chart.* FROM customer JOIN drilling_chart ON customer.idx=drilling_chart.customer_idx WHERE drilling_chart.idx=${idx}`
      )
      .then((result) => result[0][0]);
    res.status(200).json({ ...chartDetails });
  }
);

// 지공차트 수정
router.put(
  "/drilling-chart",
  isAuth,
  [
    body("ball_name").notEmpty().withMessage("볼 이름을 입력해 주세요."),
    body("weight").notEmpty().withMessage("무게를 입력해 주세요."),
    body("driller_idx").notEmpty().withMessage("지공사를 선택해 주세요."),
    validate,
  ],
  async (req, res) => {
    const {
      chart_idx,
      chart_data,
      ball_name,
      weight,
      driller_idx,
      hand,
      layout,
      pin,
      memo,
    } = req.body;
    await db.execute(
      "UPDATE drilling_chart SET chart_data=?, ball_name=?, weight=?, driller_idx=?, hand=?, layout=?, pin=?, memo=?, updated_time=? WHERE idx=?",
      [
        chart_data.join(","),
        ball_name,
        weight,
        driller_idx,
        hand,
        layout,
        pin,
        memo == "null" ? "" : memo,
        new Date(),
        chart_idx,
      ]
    );
    res.sendStatus(204);
  }
);

// 지공차트 선택 삭제
router.post(
  "/drilling-chart-delete",
  isAuth,
  [
    body("idx")
      .isLength({ min: 1 })
      .withMessage("지공차트 idx를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { idx } = req.body;
      const chartList = await db
        .query(
          `SELECT ANY_VALUE(user_idx) as user_idx, customer_idx FROM drilling_chart WHERE idx IN (${idx}) GROUP BY customer_idx`
        )
        .then((r) => r[0]);

      await db.execute(
        `UPDATE drilling_chart SET deleted_time=? WHERE idx IN(${idx})`,
        [new Date()]
      );

      // 회원별 지공차트 존재여부 확인 및 태그 부여/삭제
      const tagPromises = chartList.map(async (row) => {
        // 회원 지공차트 존재여부
        const isExist = await db
          .query(
            `SELECT idx FROM drilling_chart WHERE customer_idx=${row.customer_idx} AND deleted_time IS NULL AND idx!=${idx} LIMIT 1`
          )
          .then((r) => r[0][0]);

        // 실행 후 지공차트 없을시
        if (!isExist) {
          await addTagToCustomer({
            tagName: "지공차트미이용",
            user_idx: row.user_idx,
            customer_idx: row.customer_idx,
          });
          await removeTagToCustomer({
            tagName: "지공차트이용",
            user_idx: row.user_idx,
            customer_idx: row.customer_idx,
          });
        }
      });

      await Promise.all(tagPromises);

      res.sendStatus(204);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 지공차트 제목 수정
router.put(
  "/drilling-chart-name",
  isAuth,
  [
    body("chart_idx").notEmpty().withMessage("차트 idx를 입력해 주세요."),
    body("chart_name").notEmpty().withMessage("차트 이름을 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { chart_idx, chart_name } = req.body;
      await db.execute("UPDATE drilling_chart SET chart_name=? WHERE idx=?", [
        chart_name,
        chart_idx,
      ]);
      res.sendStatus(204);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

router.post(
  "/check-phone-exist",
  isAuth,
  [body("phone").notEmpty().withMessage("폰넘버 넣어주세요"), validate],
  async (req, res) => {
    const { phone } = req.body;
    const user_idx =
      req.authorizedUser == 1 ? req.body.user_idx : req.authorizedUser;

    const isExist = await db
      .query(
        `SELECT COUNT(idx) AS exist FROM customer WHERE user_idx=? AND deleted_time IS NULL AND phone=?`,
        [user_idx, phone]
      )
      .then((r) => r[0][0].exist);
    if (isExist) {
      res
        .status(409)
        .json({ message: "동일한 번호를 사용 중인 회원이 이미 존재합니다." });
      return;
    }
    res.sendStatus(200);
  }
);

export default router;
