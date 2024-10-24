import dayjs from "dayjs";
import express from "express";
import multer from "multer";

import { body, query } from "express-validator";
import { db } from "../db/database.js";
import {
  isAdminAuth,
  talkPush,
  validate,
  addTagToCustomer,
  isAuth,
} from "../middleware/functions.js";
import bcrypt from "bcrypt";
import { config, URI } from "../../config.js";

const router = express.Router();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "_" + file.originalname);
  },
});
export const upload = multer({ storage: storage });

// 가맹점 목록 & 검색
router.get("/store-list", isAdminAuth, async (req, res) => {
  try {
    const {
      column = "user_idx",
      order = "DESC",
      keyword,
      page = 1,
    } = req.query;
    const amount = req.query.amount ?? 10;
    const countMembership = await db
      .query(
        `SELECT COUNT(store.idx) AS count FROM store JOIN user ON store.user_idx=user.idx WHERE user.grade=1&&user.deleted_time IS NULL`
      )
      .then((result) => result[0][0].count);
    const countFree = await db
      .query(
        `SELECT COUNT(store.idx) AS count FROM store JOIN user ON store.user_idx=user.idx WHERE user.grade=0&&user.deleted_time IS NULL`
      )
      .then((result) => result[0][0].count);
    console.log("유료 회원 수", countMembership);
    if (!keyword) {
      const total = await db
        .query(
          `SELECT COUNT(store.idx) AS total FROM store JOIN user ON store.user_idx=user.idx WHERE user.deleted_time IS NULL`
        )
        .then((result) => result[0][0].total);

      // TODO: 여기 이메일 변경 가능 여부 판단하기 위해 그룹 바이에 이메일은 제외시킴
      const list = await db
        .query(
          `SELECT 
            user.idx AS user_idx, 
            user.created_time as created_time, 
            user.name AS user_name, 
            user.phone, 
            user.grade, 
            user.email, 
            store.idx AS idx, 
            store.type AS type, 
            store.name AS store_name, 
            store.address1 AS address1, 
            store.address2 AS address2, 
            store.contact AS contact, 
            (SELECT SUM(PH.amount) - SUM(CASE WHEN PR.amount IS NULL THEN 0 ELSE PR.amount END) FROM payment_history AS PH LEFT JOIN payment_refund AS PR ON PH.refund_idx = PR.idx WHERE user_idx=user.idx AND is_default=0) as amount, 
            (SELECT COUNT(idx) FROM user_memo WHERE user_idx = user.idx) as memo_count,
            (SELECT SUM(charge) FROM message WHERE user_idx = user.idx) as message_charge
          FROM user 
          JOIN store ON store.user_idx=user.idx 
          WHERE 
            user.deleted_time IS NULL 
          ORDER BY ${column} ${order} LIMIT ${amount} OFFSET ${
            amount * (page - 1)
          }`
        )
        .then((result) => result[0]);
      res.status(200).json({ total, list, countMembership, countFree });
    } else {
      const total = await db
        .query(
          `SELECT COUNT(store.idx) AS total FROM store JOIN user ON store.user_idx=user.idx WHERE (user.name LIKE '%${keyword}%'||user.phone LIKE '%${keyword}%'||store.name LIKE '%${keyword}%'||store.address1 LIKE '%${keyword}%'||store.address2 LIKE '%${keyword}%')&&user.deleted_time IS NULL`
        )
        .then((result) => result[0][0].total);
      const list = await db
        .query(
          // `SELECT user.idx AS user_idx, user.created_time as created_time, user.name AS user_name, user.phone, user.grade, user.email, store.idx, store.type, store.name AS store_name, store.address1, store.address2, store.contact, group_concat(DISTINCT talk_dday.dday) as dday,(SELECT SUM(amount) FROM payment_history WHERE user.idx=user_idx GROUP BY user_idx ) as amount FROM user JOIN store ON store.user_idx=user.idx LEFT JOIN talk_dday ON user.idx=talk_dday.user_idx WHERE talk_dday.deleted_time IS NULL&&(user.name LIKE '%${keyword}%'||user.phone LIKE '%${keyword}%'||store.name LIKE '%${keyword}%')&&user.deleted_time IS NULL GROUP BY talk_dday.user_idx, user.idx, user.name,user.phone,user.email,store.idx,store.type,store.name,store.address1, store.address2, store.contact ORDER BY ${column} ${order} LIMIT ${amount} OFFSET ${
          //   amount * (page - 1)
          // }`
          `SELECT 
            user.idx AS user_idx, 
            user.created_time as created_time, 
            user.name AS user_name, 
            user.phone, user.grade, 
            user.email, 
            store.idx AS idx, 
            store.type AS type, 
            store.name AS store_name, 
            store.address1 AS address1, 
            store.address2 AS address2, 
            store.contact AS contact, 
            (SELECT SUM(PH.amount) - SUM(CASE WHEN PR.amount IS NULL THEN 0 ELSE PR.amount END) FROM payment_history AS PH LEFT JOIN payment_refund AS PR ON PH.refund_idx = PR.idx WHERE user_idx=user.idx AND is_default=0) as amount, 
            (SELECT COUNT(idx) FROM user_memo WHERE user_idx = user.idx) as memo_count,
            (SELECT SUM(charge) FROM message WHERE user_idx = user.idx) as message_charge
          FROM user 
          JOIN store ON store.user_idx=user.idx 
          WHERE 
            (user.name LIKE '%${keyword}%'||user.phone LIKE '%${keyword}%'||store.name LIKE '%${keyword}%'||store.address1 LIKE '%${keyword}%'||store.address2 LIKE '%${keyword}%')
            &&user.deleted_time IS NULL 
          ORDER BY ${column} ${order} LIMIT ${amount} OFFSET ${
            amount * (page - 1)
          }`
        )
        .then((result) => result[0]);
      res.status(200).json({ total, list, countMembership, countFree });
    }
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

// 라커 구분 목록 - 요금표 포함
router.get(
  "/locker-type",
  isAdminAuth,
  [
    query("user_idx")
      .trim()
      .notEmpty()
      .withMessage("가맹점 idx를 입력해주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { page, user_idx } = req.query;
      const amount = req.query.amount ?? 10;
      const total = await db
        .query(
          `SELECT COUNT(idx) AS total FROM locker_type WHERE user_idx=${user_idx}&&deleted_time IS NULL`
        )
        .then((result) => result[0][0].total);
      const list = await db
        .query(
          `SELECT locker_type.idx as idx,locker_type.locker_type as locker_type,locker_type.start_number as start_number,locker_type.locker_amount as locker_amount, group_concat(DISTINCT talk_dday.dday) as dday FROM locker_type LEFT JOIN talk_dday ON locker_type.idx=talk_dday.locker_type_idx  WHERE talk_dday.deleted_time IS NULL&&locker_type.user_idx=${user_idx}&&locker_type.deleted_time IS NULL GROUP BY locker_type.idx ORDER BY idx LIMIT ${amount} OFFSET ${
            amount * (page - 1)
          }`
        )
        .then((result) => result[0]);
      // console.log(list);
      const chargeList = await Promise.all(
        list.map(async (item) => {
          const charge = await db
            .query(
              `SELECT idx, period, charge, deposit, period_type FROM charge WHERE locker_type_idx=${item.idx}&&deleted_time IS NULL`
            )
            .then((result) => result[0]);
          return { ...item, charge: charge };
        })
      );
      // console.log(chargeList);
      const storeName = await db
        .query(`SELECT name FROM store WHERE user_idx=${user_idx}`)
        .then((result) => result[0][0].name);
      res.status(200).json({ total, chargeList, storeName });
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 라커 구분 등록
router.post(
  "/locker-type",
  isAdminAuth,
  [
    body("locker_type")
      .trim()
      .notEmpty()
      .withMessage("라커 타입을 입력해 주세요."),
    body("locker_amount")
      .trim()
      .notEmpty()
      .withMessage("라커 개수를 입력해 주세요."),
    body("start_number")
      .trim()
      .notEmpty()
      .withMessage("시작 번호를 입력해 주세요."),
    body("user_idx").trim().notEmpty().withMessage("유저 idx를 입력해 주세요."),
    body("talk_dday")
      .isLength({ min: 1 })
      .withMessage("알림주기를 설정해 주세요."),
    body("charge").isLength({ min: 1 }).withMessage("요금제를 등록해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const {
        user_idx,
        locker_type,
        locker_amount,
        start_number,
        charge,
        talk_dday,
      } = req.body;
      // console.log(req.body);
      const foundType = await db
        .execute(
          `SELECT idx FROM locker_type WHERE user_idx=${user_idx}&&locker_type='${locker_type}'&&deleted_time IS NULL`
        )
        .then((result) => result[0][0]);
      if (foundType) {
        res.status(409).json({ message: "라커 타입 중복됨." });
      } else {
        const result = await db.execute(
          "INSERT INTO locker_type (user_idx, locker_type, locker_amount, start_number, created_time) VALUES (?,?,?,?,?)",
          [user_idx, locker_type, locker_amount, start_number, new Date()]
        );
        console.log("리턴", result[0].insertId);
        const insertId = result[0].insertId;
        for (const i of charge) {
          console.log(i);
          await db.execute(
            "INSERT INTO charge (locker_type_idx, period_type, period, charge, deposit) VALUES (?,?,?,?,?)",
            [
              insertId,
              Number(i.period_type),
              Number(i.period),
              Number(i.charge),
              Number(i.deposit),
            ]
          );
        }
        for (const i of talk_dday) {
          // console.log(i);
          await db.execute(
            "INSERT INTO talk_dday (user_idx, locker_type_idx, dday) VALUES (?,?,?)",
            [user_idx, insertId, Number(i)]
          );
        }
        res.sendStatus(201);
      }
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// // 라커 구분 선택 삭제
// router.post(
//   "/locker-type-delete",
//   isAdminAuth,
//   [
//     body("idx").trim().notEmpty().withMessage("라커 타입 idx를 입력해 주세요."),
//     validate,
//   ],
//   async (req, res) => {
//     try {
//       // console.log("asdasdasd", req.body);
//       const user_idx = req.body.user_idx;
//       const idx = req.body.idx.split(",");
//       const date = dayjs().format("YYYY-MM-DD HH:mm:ss");
//       const today = dayjs().format("YYYY-MM-DD");
//       const list = [];
//       for (const i of idx) {
//         const locker = await db
//           .execute(`SELECT * FROM locker_type WHERE idx=${i}`)
//           .then((result) => result[0][0]);
//         // console.log(locker);
//         const findCustomer = await db
//           .execute(
//             `SELECT idx FROM locker WHERE user_idx=${user_idx}&&locker_type='${locker.locker_type}'&&end_date >='${today}'&& deleted_time IS NULL`
//           )
//           .then((result) => result[0][0]);
//         // console.log("findCustomer", findCustomer);
//         if (findCustomer) {
//           return res.status(409).json({
//             message: `${locker.locker_type}에 이용중인 사용자가 있습니다.`,
//           });
//         }
//       }
//       await db.execute(
//         `UPDATE locker_type SET deleted_time='${date}' WHERE idx IN(${idx})`
//       );
//       res.sendStatus(204);
//     } catch (e) {
//       console.log(e);
//       res.sendStatus(500);
//     }
//   }
// );

// 라커 구분 수정
router.put(
  "/locker-type",
  isAdminAuth,
  [
    body("user_idx").trim().notEmpty().withMessage("유저 idx를 입력해 주세요."),
    body("locker_type_idx")
      .trim()
      .notEmpty()
      .withMessage("라커 타입 idx를 입력해 주세요."),
    body("locker_type")
      .trim()
      .notEmpty()
      .withMessage("라커 타입을 입력해 주세요."),
    body("locker_amount")
      .trim()
      .notEmpty()
      .withMessage("라커 개수를 입력해 주세요."),
    body("start_number")
      .trim()
      .notEmpty()
      .withMessage("시작 번호를 입력해 주세요."),
    body("talk_dday")
      .isLength({ min: 1 })
      .withMessage("알림주기를 설정해 주세요."),
    body("charge").isLength({ min: 1 }).withMessage("요금제를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const {
        user_idx,
        locker_type_idx,
        locker_type,
        locker_amount,
        start_number,
        charge,
        talk_dday,
      } = req.body;
      const foundType = await db
        .execute(
          `SELECT * FROM locker_type WHERE user_idx=${user_idx}&&locker_type='${locker_type}'&&idx!=${locker_type_idx}&&deleted_time IS NULL`
        )
        .then((result) => result[0][0]);
      if (foundType && foundType.locker_type !== locker_type) {
        res.status(409).json({ message: "라커 구분명이 중복됩니다." });
      } else {
        const beforeType = await db
          .execute(`SELECT * FROM locker_type WHERE idx=${locker_type_idx}`)
          .then((result) => result[0][0]);
        const foundCustomer = await db
          .execute(
            `SELECT * FROM locker WHERE user_idx=${user_idx}&&deleted_time IS NULL&&(locker_number<${start_number}||locker_number>(${start_number}+${locker_amount}-1))&&locker_type='${beforeType.locker_type}'`
          )
          .then((result) => result[0][0]);
        if (foundCustomer) {
          console.log(foundCustomer);
          return res.status(409).json({
            message:
              "설정한 라커번호 범위 내에서 벗어나는 고객이 등록 되어 있습니다.",
          });
        }
        await db.execute(
          "UPDATE locker_type SET locker_type=?, locker_amount=?, start_number=?, updated_time=? WHERE idx=?",
          [
            locker_type,
            locker_amount,
            start_number,
            new Date(),
            locker_type_idx,
          ]
        );
        await db.execute(
          "UPDATE locker SET locker_type=? WHERE user_idx=? && locker_type=? && deleted_time IS NULL",
          [locker_type, user_idx, beforeType.locker_type]
        );
        await db.execute(
          "UPDATE charge SET deleted_time=? WHERE locker_type_idx=?",
          [new Date(), locker_type_idx]
        );
        for (const i of charge) {
          console.log(i);
          await db.execute(
            "INSERT INTO charge (locker_type_idx, period_type, period, charge,deposit) VALUES (?,?,?,?,?)",
            [
              locker_type_idx,
              Number(i.period_type),
              Number(i.period),
              Number(i.charge),
              Number(i.deposit),
            ]
          );
        }
        await db.execute(
          "UPDATE talk_dday SET deleted_time=? WHERE locker_type_idx=?",
          [new Date(), locker_type_idx]
        );
        for (const i of talk_dday) {
          // console.log(i);
          await db.execute(
            "INSERT INTO talk_dday (user_idx, locker_type_idx, dday) VALUES (?,?,?)",
            [user_idx, locker_type_idx, Number(i)]
          );
        }
        res.sendStatus(201);
      }
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 가맹점 정보 불러오기
router.get(
  "/store",
  isAdminAuth,
  [
    query("user_idx")
      .trim()
      .notEmpty()
      .withMessage("회원(가맹점주) idx를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { user_idx } = req.query;
      const list = await db
        .execute(
          `SELECT user.name AS user_name, user.phone, user.email, store.type, store.name AS store_name, store.address1, store.address2, store.contact FROM store JOIN user ON store.user_idx=user.idx WHERE store.user_idx=${user_idx}&&user.deleted_time IS NULL`
        )
        .then((result) => result[0]);
      res.status(200).json(list);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 라커 전체 목록 & 검색 (항목별 오름차순/내림차순 정렬) - 리스트
router.get(
  "/locker-list",
  isAdminAuth,
  [
    query("user_idx")
      .trim()
      .notEmpty()
      .withMessage("user_idx를 입력해 주세요."),
    query("column")
      .trim()
      .notEmpty()
      .withMessage("정렬할 항목을 입력해 주세요."),
    query("order").trim().notEmpty().withMessage("정렬 방식을 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { user_idx, column, order, keyword, page } = req.query;
      console.log(req.query);
      const amount = req.query.amount ?? 10;
      if (!keyword) {
        const total = await db
          .execute(
            `SELECT COUNT(locker.idx) AS total FROM (SELECT MAX(idx) AS idx FROM locker WHERE locker.user_idx=${user_idx} && locker.customer_idx IS NOT NULL group by locker_type,locker_number) locker_idx JOIN locker ON locker_idx.idx=locker.idx WHERE locker.deleted_time IS NULL`
          )
          .then((result) => result[0][0].total);

        const list = await db
          .execute(
            `SELECT charge.charge, charge.period, charge.deposit, charge.period_type, locker.idx,locker.user_idx,locker.customer_idx,locker.locker_number,locker.locker_type,locker.start_date,locker.end_date,locker.used,locker.remain,locker.paid, locker.deleted_time AS deleted_time,customer.name,customer.phone FROM (SELECT MAX(idx) as idx from locker WHERE locker.user_idx=${user_idx} && locker.customer_idx IS NOT NULL GROUP BY locker.locker_type, locker.locker_number) locker_idx JOIN locker on locker.idx = locker_idx.idx LEFT JOIN customer ON locker.customer_idx=customer.idx LEFT JOIN charge ON locker.charge=charge.idx WHERE locker.deleted_time IS NULL ORDER BY ${column} ${order} LIMIT ${amount} OFFSET ${
              amount * (page - 1)
            }`
          )
          .then((result) => result[0]);
        const lockerCount = await db
          .execute(
            `SELECT SUM(locker_amount) AS lockerCount FROM locker_type WHERE user_idx=${user_idx}&&deleted_time IS NULL`
          )
          .then((result) => result[0][0].lockerCount);
        const expiredCount = await db
          .execute(
            `SELECT COUNT(locker.idx) AS expiredCount FROM (select max(idx) as idx from locker WHERE locker.user_idx=${user_idx}  && locker.customer_idx IS NOT NULL group by locker_type,locker_number) locker_idxs JOIN locker ON locker.idx=locker_idxs.idx WHERE locker.remain=-1&&locker.deleted_time IS NULL`
          )
          .then((result) => result[0][0].expiredCount);
        return res
          .status(200)
          .json({ total, list, allCount: total, lockerCount, expiredCount });
      } else {
        const total = await db
          .execute(
            `SELECT COUNT(locker.idx) AS total FROM (SELECT MAX(idx) AS idx FROM locker WHERE locker.user_idx=${user_idx} && locker.customer_idx IS NOT NULL group by locker_type,locker_number) locker_idxs JOIN locker ON locker.idx = locker_idxs.idx JOIN customer ON locker.customer_idx = customer.idx  WHERE (customer.name LIKE \'%${keyword}%\'||customer.phone LIKE \'%${keyword}%\'||customer.memo LIKE \'%${keyword}%\')&&locker.deleted_time IS NULL`
          )
          .then((result) => result[0][0].total);
        const allCount = await db
          .execute(
            `SELECT COUNT(locker.idx) AS total FROM (select max(idx) as idx from locker WHERE locker.user_idx=${user_idx} && locker.customer_idx IS NOT NULL group by locker_type,locker_number) locker_idxs JOIN locker ON locker.idx=locker_idxs.idx WHERE locker.deleted_time IS NULL`
          )
          .then((result) => result[0][0].total);
        const list = await db
          .execute(
            `SELECT charge.charge, charge.period, charge.deposit, charge.period_type, locker.idx,locker.user_idx,locker.customer_idx,locker.locker_number,locker.locker_type,locker.start_date,locker.end_date,locker.used,locker.remain,locker.paid, locker.deleted_time AS deleted_time,customer.name,customer.phone FROM (SELECT MAX(idx) as idx from locker WHERE locker.user_idx=${user_idx} && locker.customer_idx IS NOT NULL GROUP BY locker.locker_type, locker.locker_number) locker_idx JOIN locker on locker.idx = locker_idx.idx LEFT JOIN customer ON locker.customer_idx=customer.idx JOIN charge ON locker.charge=charge.idx WHERE (customer.name LIKE \'%${keyword}%\'||customer.phone LIKE \'%${keyword}%\'||customer.memo LIKE \'%${keyword}%\')&&locker.deleted_time IS NULL ORDER BY ${column} ${order} LIMIT ${amount} OFFSET ${
              amount * (page - 1)
            }`
          )
          .then((result) => result[0]);
        const lockerCount = await db
          .execute(
            `SELECT SUM(locker_amount) AS lockerCount FROM locker_type WHERE user_idx=${user_idx}&&deleted_time IS NULL`
          )
          .then((result) => result[0][0].lockerCount);
        const expiredCount = await db
          .execute(
            `SELECT COUNT(locker.idx) AS expiredCount FROM (select max(idx) as idx from locker WHERE locker.user_idx=${user_idx} && locker.customer_idx IS NOT NULL group by locker_type,locker_number) locker_idxs JOIN locker ON locker.idx=locker_idxs.idx WHERE locker.remain=-1&&locker.deleted_time IS NULL`
          )
          .then((result) => result[0][0].expiredCount);
        return res
          .status(200)
          .json({ total, list, allCount, lockerCount, expiredCount });
      }
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 라커 구분 목록 - 요금표 포함 (페이지네이션 없는 것)
router.post("/locker-type-all", isAdminAuth, async (req, res) => {
  try {
    const { user_idx } = req.body;
    const list = await db
      .execute(
        `SELECT * FROM locker_type WHERE user_idx=${user_idx}&&deleted_time IS NULL ORDER BY idx`
      )
      .then((result) => result[0]);
    const chargeList = await Promise.all(
      list.map(async (item) => {
        const charge = await db
          .execute(
            `SELECT idx, period, charge,deposit,period_type FROM charge WHERE locker_type_idx=${item.idx}&&deleted_time IS NULL`
          )
          .then((result) => result[0]);
        return { ...item, charge: charge };
      })
    );
    res.status(200).json({ chargeList });
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

// 라커 타입별 전체 목록 - 배열
router.post("/locker-array", isAdminAuth, async (req, res) => {
  try {
    const { user_idx, locker_type } = req.body;
    const date = dayjs().subtract(1, "day").format("YYYY-MM-DD");
    const list = await db
      .execute(
        `SELECT locker.remain, locker.idx, locker.customer_idx,locker.locker_number,locker.locker_type,locker.start_date,locker.end_date, locker.available, customer.name FROM locker LEFT JOIN customer ON locker.customer_idx=customer.idx WHERE locker.user_idx=${user_idx}&&locker.locker_type='${locker_type}'&&locker.deleted_time IS NULL&&locker.end_date>'${date}' ORDER BY locker_number`
      )
      .then((result) => result[0]);
    return res.status(200).json({ list });
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

// 라커(이용자) 추가
router.post(
  "/locker",
  isAdminAuth,
  [
    body("user_idx").trim().notEmpty().withMessage("user_idx를 입력해 주세요."),
    body("customer_name")
      .trim()
      .notEmpty()
      .withMessage("사용자 이름을 입력해 주세요."),
    body("customer_phone")
      .trim()
      .notEmpty()
      .withMessage("사용자 휴대폰 번호를 입력해 주세요."),
    body("locker_type")
      .trim()
      .notEmpty()
      .withMessage("라커 구분을 입력해 주세요."),
    body("locker_number")
      .trim()
      .notEmpty()
      .withMessage("라커 번호를 입력해 주세요."),
    body("start_date").trim().notEmpty().withMessage("시작일을 입력해 주세요."),
    body("end_date").trim().notEmpty().withMessage("종료일을 입력해 주세요."),
    body("charge").trim().notEmpty().withMessage("요금을 입력해 주세요."),
    body("paid").trim().notEmpty().withMessage("수납 여부를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const {
        user_idx,
        customer_name,
        customer_phone,
        locker_type,
        locker_number,
        start_date,
        end_date,
        charge,
        paid,
        memo = "",
      } = req.body;
      const today = dayjs().format("YYYY-MM-DD");

      const used =
        dayjs(today).diff(start_date, "day") >= 0
          ? dayjs(end_date).diff(dayjs(today), "day") >= 0
            ? dayjs(today).diff(dayjs(start_date), "day") + 1
            : dayjs(end_date).diff(dayjs(start_date), "day") + 1
          : 0;
      const remain =
        dayjs(today).diff(start_date, "day") >= 0
          ? dayjs(end_date).diff(dayjs(today), "day")
          : dayjs(end_date).diff(dayjs(start_date), "day") + 1;
      const foundCustomer = await db
        .execute(
          `SELECT idx FROM customer WHERE user_idx=${user_idx} &&phone='${customer_phone}'`
        )
        .then((result) => result[0][0]);

      if (!foundCustomer) {
        const result = await db.execute(
          "INSERT INTO customer (user_idx, name, phone, created_time ) VALUES (?,?,?,?)",
          [user_idx, customer_name, customer_phone, new Date()]
        );

        const customer_idx = result[0].insertId;
        await db.execute(
          "INSERT INTO locker ( user_idx, customer_idx, locker_type, locker_number, start_date, end_date, charge, paid, created_time, used, remain) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          [
            user_idx,
            customer_idx,
            locker_type,
            locker_number,
            start_date,
            end_date,
            charge,
            paid,
            new Date(),
            used,
            remain,
          ]
        );
        const price = await db
          .execute(`SELECT charge FROM charge WHERE idx=${charge}`)
          .then((result) => result[0][0].charge);
        await db.execute(
          "INSERT INTO locker_log ( type, user_idx, customer_idx, locker_type, locker_number, start_date, end_date, charge, handled_time) VALUES (?,?,?,?,?,?,?,?,?)",
          [
            "추가 (관리자)",
            user_idx,
            customer_idx,
            locker_type,
            locker_number,
            start_date,
            end_date,
            price,
            new Date(),
          ]
        );

        if (paid !== "수납") {
          await addTagToCustomer({
            tagName: "라커비미납",
            user_idx,
            customer_idx,
          });
        }

        res.sendStatus(201);
      } else {
        await db.execute(
          `UPDATE customer SET memo='${memo == "null" ? "" : memo}' WHERE idx=${
            foundCustomer.idx
          }`
        );
        await db.execute(
          "INSERT INTO locker ( user_idx, customer_idx, locker_type, locker_number, start_date, end_date, charge, paid, created_time, used, remain) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          [
            user_idx,
            foundCustomer.idx,
            locker_type,
            locker_number,
            start_date,
            end_date,
            charge,
            paid,
            new Date(),
            used,
            remain,
          ]
        );
        const price = await db
          .execute(`SELECT charge FROM charge WHERE idx=${charge}`)
          .then((result) => result[0][0].charge);
        await db.execute(
          "INSERT INTO locker_log ( type, user_idx, customer_idx, locker_type, locker_number, start_date, end_date, charge, handled_time) VALUES (?,?,?,?,?,?,?,?,?)",
          [
            "추가 (관리자)",
            user_idx,
            foundCustomer.idx,
            locker_type,
            locker_number,
            start_date,
            end_date,
            price,
            new Date(),
          ]
        );

        if (paid !== "수납") {
          await addTagToCustomer({
            tagName: "라커비미납",
            user_idx,
            customer_idx: foundCustomer.idx,
          });
        }

        res.sendStatus(201);
      }
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 라커 수리중 설정
router.put(
  "/locker-fix",
  isAdminAuth,
  [
    body("user_idx").trim().notEmpty().withMessage("user_idx를 입력해 주세요."),
    body("locker_type")
      .trim()
      .notEmpty()
      .withMessage("라커 타입을 입력해 주세요."),
    body("locker_number")
      .trim()
      .notEmpty()
      .withMessage("라커 넘버를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { user_idx, locker_type, locker_number } = req.body;
      const lockerInfo = await db
        .execute(
          `SELECT * FROM locker WHERE user_idx=${user_idx}&&locker_type='${locker_type}'&&locker_number='${locker_number}'&&deleted_time IS NULL`
        )
        .then((result) => result[0][0]);
      console.log(lockerInfo);
      if (lockerInfo) {
        await db.execute(
          `UPDATE locker SET available=0 WHERE user_idx=${user_idx}&&locker_type='${locker_type}'&&locker_number='${locker_number}'&&deleted_time IS NULL`
        );
        res.sendStatus(204);
      } else {
        await db.execute(
          "INSERT INTO locker (user_idx, locker_type, locker_number, start_date, end_date, paid, created_time, available) VALUES (?,?,?,?,?,?,?,?)",
          [
            user_idx,
            locker_type,
            locker_number,
            new Date(),
            "9999-12-31",
            "미수납",
            new Date(),
            0,
          ]
        );
        res.sendStatus(204);
      }
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 라커 이용가능 설정
router.put(
  "/locker-available",
  isAdminAuth,
  [
    body("user_idx").trim().notEmpty().withMessage("user_idx를 입력해 주세요."),
    body("locker_type")
      .trim()
      .notEmpty()
      .withMessage("라커 타입을 입력해 주세요."),
    body("locker_number")
      .trim()
      .notEmpty()
      .withMessage("라커 넘버를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { user_idx, locker_type, locker_number } = req.body;
      const lockerInfo = await db
        .execute(
          `SELECT * FROM locker WHERE user_idx=${user_idx}&&locker_type='${locker_type}'&&locker_number='${locker_number}'&&available=0&&deleted_time IS NULL`
        )
        .then((result) => result[0][0]);
      console.log(lockerInfo);
      if (lockerInfo.customer_idx) {
        await db.execute(
          `UPDATE locker SET available=1 WHERE user_idx=${user_idx}&&locker_type='${locker_type}'&&locker_number='${locker_number}'&&deleted_time IS NULL`
        );
        res.sendStatus(204);
      } else {
        const date = dayjs().format("YYYY-MM-DD HH:mm:ss");
        await db.execute(
          `UPDATE locker SET deleted_time='${date}' WHERE user_idx=${user_idx}&&locker_type='${locker_type}'&&locker_number='${locker_number}'&&deleted_time IS NULL`
        );
        res.sendStatus(204);
      }
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 이용자 목록 & 검색
router.get("/customer-list-active", isAdminAuth, async (req, res) => {
  try {
    const { keyword, page, column, order } = req.query;
    console.log(req.query);
    const amount = req.query.amount ?? 10;
    if (!keyword) {
      const date = dayjs().format("YYYY-MM-DD");
      const total = await db
        .execute(
          `SELECT customer.idx, customer.name, customer.phone,COUNT(locker.customer_idx) as count FROM customer JOIN locker ON customer.idx=locker.customer_idx WHERE locker.end_date>='${date}'&&locker.deleted_time IS NULL GROUP BY customer.idx`
        )
        .then((result) => result[0]);
      const list = await db
        .execute(
          `SELECT customer.idx, customer.name, customer.phone,COUNT(locker.customer_idx) as count FROM customer JOIN locker ON customer.idx=locker.customer_idx WHERE locker.end_date>='${date}'&&locker.deleted_time IS NULL GROUP BY customer.idx ORDER BY ${column} ${order} LIMIT ${amount} OFFSET ${
            amount * (page - 1)
          }`
        )
        .then((result) => result[0]);

      res.status(200).json({ total: total.length, list: list });
    } else {
      const date = dayjs().format("YYYY-MM-DD");
      const total = await db
        .execute(
          `SELECT customer.idx, customer.name, customer.phone,COUNT(locker.customer_idx) as count FROM customer JOIN locker ON customer.idx=locker.customer_idx WHERE (customer.name LIKE \'%${keyword}%\'||customer.phone LIKE \'%${keyword}%\')&&locker.end_date>='${date}'&&locker.deleted_time IS NULL GROUP BY customer.idx`
        )
        .then((result) => result[0]);
      const list = await db
        .execute(
          `SELECT customer.idx, customer.name, customer.phone,COUNT(locker.customer_idx) as count FROM customer JOIN locker ON customer.idx=locker.customer_idx WHERE (customer.name LIKE \'%${keyword}%\'||customer.phone LIKE \'%${keyword}%\')&&locker.end_date>='${date}'&&locker.deleted_time IS NULL GROUP BY customer.idx ORDER BY ${column} ${order} LIMIT ${amount} OFFSET ${
            amount * (page - 1)
          }`
        )
        .then((result) => result[0]);

      res.status(200).json({ total: total.length, list: list });
    }
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

// 이용자 라커 상세
router.get(
  "/customer-locker-list",
  isAdminAuth,
  [
    query("customer_idx")
      .trim()
      .notEmpty()
      .withMessage("사용자 idx를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { customer_idx, page } = req.query;
      const amount = req.query.amount ?? 10;
      const date = dayjs().format("YYYY-MM-DD");
      const customerName = await db
        .execute(`SELECT name FROM customer WHERE idx=${customer_idx}`)
        .then((result) => result[0][0].name);
      console.log(customerName);
      const total = await db
        .execute(
          `SELECT COUNT(locker.idx) AS total FROM locker LEFT JOIN locker_type ON locker.locker_type=locker_type.locker_type&&locker.user_idx=locker_type.user_idx JOIN store ON locker_type.user_idx=store.user_idx JOIN charge ON locker.charge=charge.idx JOIN customer ON locker.customer_idx=customer.idx WHERE locker.customer_idx=${customer_idx}&&locker.end_date>='${date}'&&locker.deleted_time IS NULL`
        )
        .then((result) => result[0][0].total);
      const list = await db
        .execute(
          `SELECT customer.name AS customer_name, customer.phone , charge.charge, store.type, store.name AS store_name, locker.locker_type, locker.locker_number, locker.start_date, locker.end_date, locker.paid, locker.used, locker.remain FROM locker LEFT JOIN locker_type ON locker.locker_type=locker_type.locker_type&&locker.user_idx=locker_type.user_idx JOIN store ON locker_type.user_idx=store.user_idx JOIN charge ON locker.charge=charge.idx JOIN customer ON locker.customer_idx=customer.idx WHERE locker.customer_idx=${customer_idx}&&locker.end_date>='${date}'&&locker.deleted_time IS NULL LIMIT ${amount} OFFSET ${
            amount * (page - 1)
          }`
        )
        .then((result) => result[0]);
      res
        .status(200)
        .json({ total: total, list: list, customerName: customerName });
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 전체 회원 목록 & 검색
router.get("/customer-list", isAdminAuth, async (req, res) => {
  try {
    const { keyword, page = 1, order = "DESC", column = "nc.idx" } = req.query;
    const amount = req.query.amount ?? 10;
    if (!keyword) {
      const total = await db
        .query(
          `SELECT COUNT(phone) AS total FROM (SELECT phone FROM customer WHERE deleted_time IS NULL GROUP BY phone) C`
        )
        .then((result) => result[0][0].total);
      const list = await db
        .query(
          `SELECT nc.idx as idx, nc.name as name,nc.phone as phone, nc.store as store, (select count(idx) from locker where FIND_IN_SET(customer_idx,nc.idxs) && locker.deleted_time IS NULL && remain > -1) as locker, (select count(idx) from drilling_chart where FIND_IN_SET(customer_idx,nc.idxs) && drilling_chart.deleted_time IS NULL) as drilling_chart FROM (SELECT MIN(idx) as idx, GROUP_CONCAT(c.idx) as idxs, ANY_VALUE(c.name) AS name, c.phone, GROUP_CONCAT(c.store) as store FROM (SELECT customer.*,store.name as store FROM customer JOIN user ON customer.user_idx = user.idx JOIN store ON store.user_idx=user.idx WHERE customer.deleted_time IS NULL) c GROUP BY c.phone) nc ORDER BY ${column} ${order} LIMIT ${amount} OFFSET ${
            amount * (page - 1)
          }
      `
        )
        .then((result) => result[0]);
      // console.log(list);
      res.status(200).json({ total, list });
    } else {
      const total = await db
        .query(
          `SELECT 
            COUNT(phone) AS total 
          FROM (
            SELECT customer.phone 
            FROM customer
            JOIN user ON customer.user_idx = user.idx 
            JOIN store ON store.user_idx=user.idx  
            WHERE (customer.name LIKE \'%${keyword}%\'||customer.phone LIKE \'%${keyword}%\'||store.name LIKE \'%${keyword}%\')&&customer.deleted_time IS NULL GROUP BY phone) C`
        )
        .then((result) => result[0][0].total);
      const list = await db
        .query(
          `SELECT 
              nc.idx as idx, nc.name as name,nc.phone as phone, nc.store as store, (select count(idx) from locker where FIND_IN_SET(customer_idx,nc.idxs) && locker.deleted_time IS NULL && remain > -1) as locker, (select count(idx) from drilling_chart where FIND_IN_SET(customer_idx,nc.idxs) && drilling_chart.deleted_time IS NULL) as drilling_chart 
              FROM (
                SELECT MIN(idx) as idx, GROUP_CONCAT(c.idx) as idxs, ANY_VALUE(c.name) AS name, c.phone, GROUP_CONCAT(c.store) as store 
                FROM (
                  SELECT customer.*,store.name as store 
                  FROM customer 
                  JOIN user ON customer.user_idx = user.idx 
                  JOIN store ON store.user_idx=user.idx 
                  WHERE customer.deleted_time IS NULL && (customer.name LIKE \'%${keyword}%\'||customer.phone LIKE \'%${keyword}%\'|| store.name LIKE \'%${keyword}%\')
                ) c GROUP BY c.phone
              ) nc 
              ORDER BY ${column} ${order} LIMIT ${amount} OFFSET ${
            amount * (page - 1)
          }`
        )
        .then((result) => result[0]);

      res.status(200).json({ total, list });
    }
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

// 전체 회원 라커 목록
router.get(
  "/all-customer-locker-list",
  isAdminAuth,
  [
    query("name").trim().notEmpty().withMessage("이름을 입력해 주세요."),
    query("phone")
      .trim()
      .notEmpty()
      .withMessage("핸드폰 번호를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { column, order, name, phone, page = 1 } = req.query;
      const amount = 10;
      const total = await db
        .query(
          `SELECT COUNT(locker.idx) AS total FROM locker JOIN store ON locker.user_idx=store.user_idx JOIN charge ON locker.charge=charge.idx JOIN customer ON locker.customer_idx=customer.idx WHERE customer.name='${name}'&&customer.phone='${phone}'`
        )
        .then((r) => r[0][0]?.total);
      if (column === "none") {
        const list = await db
          .execute(
            `SELECT customer.name AS customer_name, customer.phone , charge.charge, charge.period, charge.period_type, charge.deposit, store.type, store.name AS store_name, locker.locker_type, locker.locker_number, locker.start_date, locker.end_date, locker.paid, locker.used, locker.remain, locker.deleted_time FROM locker JOIN store ON locker.user_idx=store.user_idx JOIN charge ON locker.charge=charge.idx JOIN customer ON locker.customer_idx=customer.idx WHERE customer.name='${name}'&&customer.phone='${phone}' ORDER BY (CASE WHEN locker.remain > -1 AND locker.deleted_time IS NULL THEN 1 ELSE 2 END),store.name, store.name ASC LIMIT ${amount} OFFSET ${
              amount * (page - 1)
            } `
          )
          .then((result) => result[0]);
        console.log("초기 리스트트트트트트", list);
        res.status(200).json({ total, list });
      } else {
        const list = await db
          .execute(
            `SELECT customer.name AS customer_name, customer.phone , charge.charge, charge.period, charge.period_type, charge.deposit, store.type, store.name AS store_name, locker.locker_type, locker.locker_number, locker.start_date, locker.end_date, locker.paid, locker.used, locker.remain, locker.deleted_time FROM locker JOIN store ON locker.user_idx=store.user_idx JOIN charge ON locker.charge=charge.idx JOIN customer ON locker.customer_idx=customer.idx WHERE customer.name='${name}'&&customer.phone='${phone}' ORDER BY ${column} ${order} LIMIT ${amount} OFFSET ${
              amount * (page - 1)
            }`
          )
          .then((result) => result[0]);
        console.log("정렬 리스트트트트트트", list);
        res.status(200).json({ total, list });
      }
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 이용약관 & FAQ & 환불정책 링크 설정
router.put(
  "/terms",
  isAdminAuth,
  [
    body("link1")
      .trim()
      .notEmpty()
      .withMessage("이용약관 주소를 입력해 주세요."),
    body("link2")
      .trim()
      .notEmpty()
      .withMessage("개인정보처리방침 주소를 입력해 주세요."),
    body("link3").trim().notEmpty().withMessage("FAQ 주소를 입력해 주세요."),
    body("link4")
      .trim()
      .notEmpty()
      .withMessage("취소환불정책 주소를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { link1, link2, link3, link4 } = req.body;
      await db.execute(
        "UPDATE setting SET terms_of_use=?, privacy_policy=?, faq=?, refund_policy=? WHERE idx=1",
        [link1, link2, link3, link4]
      );
      res.sendStatus(204);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 관리자 비밀번호 변경
router.put(
  "/password",
  isAdminAuth,
  [
    body("new_password")
      .trim()
      .notEmpty()
      .withMessage("새로운 비밀번호를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { new_password } = req.body;
      const hashedPassword = await bcrypt.hash(
        new_password,
        config.bcrypt.saltRounds
      );
      await db.execute("UPDATE user SET password=? WHERE idx=?", [
        hashedPassword,
        req.authorizedUser,
      ]);
      res.sendStatus(204);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

const generateTimeFilter = (s, e, column) => {
  let result = "";
  if (s) {
    result += `${column} >= '${s}'`;
  }
  if (e) {
    result += `&& ${column} <= '${e}'`;
  }
  if (!result) {
    return "1";
  }
  return "(" + result + ")";
};

// 라커 관리 로그
router.get("/locker-log", isAdminAuth, async (req, res) => {
  try {
    const {
      column = "idx",
      order = "DESC",
      keyword,
      page = 1,
      start_date: s,
      end_date: e,
    } = req.query;

    const timeFilter = generateTimeFilter(
      s,
      dayjs(e).endOf("day").format("YYYY-MM-DD HH:mm:ss"),
      "locker_log.handled_time"
    );
    const amount = req.query.amount ?? 10;
    if (!keyword) {
      const total = await db
        .execute(
          `SELECT COUNT(locker_log.idx) AS total FROM locker_log JOIN store ON locker_log.user_idx=store.user_idx JOIN customer ON locker_log.customer_idx=customer.idx WHERE ${timeFilter}`
        )
        .then((result) => result[0][0].total);
      const list = await db
        .execute(
          `SELECT store.type AS store_type, store.name AS store_name, customer.name AS customer_name, customer.phone AS customer_phone, locker_log.*  FROM locker_log JOIN store ON locker_log.user_idx=store.user_idx JOIN customer ON locker_log.customer_idx=customer.idx WHERE ${timeFilter} ORDER BY ${column} ${order} LIMIT ${amount} OFFSET ${
            amount * (page - 1)
          }`
        )
        .then((result) => result[0]);
      res.status(200).json({ total, list });
    } else {
      const total = await db
        .execute(
          `SELECT COUNT(locker_log.idx) AS total FROM locker_log JOIN store ON locker_log.user_idx=store.user_idx JOIN customer ON locker_log.customer_idx=customer.idx WHERE ${timeFilter} && (customer.name LIKE \'%${keyword}%\'||customer.phone LIKE \'%${keyword}%\'||store.name LIKE \'%${keyword}%\')`
        )
        .then((result) => result[0][0].total);
      const list = await db
        .execute(
          `SELECT store.type AS store_type, store.name AS store_name, customer.name AS customer_name, customer.phone AS customer_phone, locker_log.*  FROM locker_log JOIN store ON locker_log.user_idx=store.user_idx JOIN customer ON locker_log.customer_idx=customer.idx WHERE ${timeFilter} && (customer.name LIKE \'%${keyword}%\'||customer.phone LIKE \'%${keyword}%\'||store.name LIKE \'%${keyword}%\') ORDER BY ${column} ${order} LIMIT ${amount} OFFSET ${
            amount * (page - 1)
          }`
        )
        .then((result) => result[0]);
      res.status(200).json({ total, list });
    }
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

// 라커 관리 로그 - 엑셀
router.get("/locker-log-excel", isAdminAuth, async (req, res) => {
  try {
    const {
      column = "idx",
      order = "ASC",
      keyword,
      start_date: s,
      end_date: e,
    } = req.query;

    const timeFilter = generateTimeFilter(s, e, "locker_log.handled_time");
    if (!keyword) {
      const list = await db
        .execute(
          `SELECT store.type AS store_type, store.name AS store_name, customer.name AS customer_name, customer.phone AS customer_phone, locker_log.*  FROM locker_log JOIN store ON locker_log.user_idx=store.user_idx JOIN customer ON locker_log.customer_idx=customer.idx WHERE ${timeFilter} ORDER BY ${column} ${order}`
        )
        .then((result) => result[0]);
      res.status(200).json({ list });
    } else {
      const list = await db
        .execute(
          `SELECT store.type AS store_type, store.name AS store_name, customer.name AS customer_name, customer.phone AS customer_phone, locker_log.*  FROM locker_log JOIN store ON locker_log.user_idx=store.user_idx JOIN customer ON locker_log.customer_idx=customer.idx WHERE ${timeFilter} && (customer.name LIKE \'%${keyword}%\'||customer.phone LIKE \'%${keyword}%\'||store.name LIKE \'%${keyword}%\') ORDER BY ${column} ${order}`
        )
        .then((result) => result[0]);
      res.status(200).json({ list });
    }
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

// 카카오 알림톡 로그
router.get("/talk-log", isAdminAuth, async (req, res) => {
  try {
    const {
      column = "idx",
      order = "DESC",
      keyword,
      page = 1,
      start_date: s,
      end_date: e,
    } = req.query;
    const timeFilter = generateTimeFilter(s, e, "created_time");
    const amount = req.query.amount ?? 10;
    if (!keyword) {
      const total = await db
        .execute(`SELECT COUNT(idx) AS total FROM talk_log WHERE ${timeFilter}`)
        .then((result) => result[0][0].total);
      const list = await db
        .execute(
          `SELECT * FROM talk_log WHERE ${timeFilter} ORDER BY ${column} ${order} LIMIT ${amount} OFFSET ${
            amount * (page - 1)
          }`
        )
        .then((result) => result[0]);
      res.status(200).json({ total, list });
    } else {
      const total = await db
        .execute(
          `SELECT COUNT(idx) AS total FROM talk_log WHERE ${timeFilter} AND (store_name LIKE \'%${keyword}%\'||customer_phone LIKE \'%${keyword}%\'||customer_name LIKE \'%${keyword}%\')`
        )
        .then((result) => result[0][0].total);
      const list = await db
        .execute(
          `SELECT * FROM talk_log WHERE ${timeFilter} AND (store_name LIKE \'%${keyword}%\'||customer_phone LIKE \'%${keyword}%\'||customer_name LIKE \'%${keyword}%\') ORDER BY ${column} ${order} LIMIT ${amount} OFFSET ${
            amount * (page - 1)
          }`
        )
        .then((result) => result[0]);
      res.status(200).json({ total, list });
    }
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});
// 카카오 알림톡 로그 - 엑셀
router.get("/talk-log-excel", isAdminAuth, async (req, res) => {
  try {
    const {
      column = "idx",
      order = "DESC",
      keyword,
      start_date: s,
      end_date: e,
    } = req.query;
    const timeFilter = generateTimeFilter(s, e, "created_time");
    if (!keyword) {
      const list = await db
        .execute(
          `SELECT * FROM talk_log WHERE ${timeFilter} ORDER BY ${column} ${order}`
        )
        .then((result) => result[0]);
      res.status(200).json({ list });
    } else {
      const list = await db
        .execute(
          `SELECT * FROM talk_log WHERE ${timeFilter} AND (store_name LIKE \'%${keyword}%\'||customer_phone LIKE \'%${keyword}%\'||customer_name LIKE \'%${keyword}%\') ORDER BY ${column} ${order}`
        )
        .then((result) => result[0]);
      res.status(200).json({ list });
    }
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

// 메세지 전송 내역 불러오기 ( 어드민 )
router.get("/message-log", isAdminAuth, async (req, res) => {
  const amount = 10;
  try {
    const {
      start_date,
      end_date,
      type,
      is_ad,
      column = "created_time",
      order = "DESC",
      keyword,
      page = 1,
      user_idx,
    } = req.query;
    let orderBlock = "";
    if (
      ["is_reserve", "type", "is_ad", "created_time", "store_name"].includes(
        column
      ) &&
      ["ASC", "DESC"].includes(order.toUpperCase())
    ) {
      orderBlock = `ORDER BY ${column} ${order} `;
    }
    let whereBlock = "";
    if (user_idx) {
      whereBlock += `&& M.user_idx = ${user_idx} `;
    }
    if (start_date) {
      whereBlock += `&& M.created_time >= '${dayjs(start_date)
        .startOf("day")
        .format("YYYY-MM-DD HH:mm:ss")}' `;
    }
    if (end_date) {
      whereBlock += `&& M.created_time <= '${dayjs(end_date)
        .endOf("day")
        .format("YYYY-MM-DD HH:mm:ss")}' `;
    }
    if (type) {
      whereBlock += `&& M.type = '${type.toUpperCase()}' `;
    }
    if (is_ad != null) {
      if (is_ad == 1) {
        whereBlock += `&& M.is_ad = 1 `;
      } else {
        whereBlock += `&& M.is_ad = 0 `;
      }
    }
    console.log(typeof is_ad, is_ad);
    if (keyword) {
      whereBlock += "&& (";
      whereBlock += `M.names LIKE '%${keyword}%' `;
      whereBlock += `|| M.phones LIKE '%${keyword}%' `;
      whereBlock += `|| M.msg LIKE '%${keyword}%' `;
      whereBlock += `|| S.name LIKE '%${keyword}%'`;
      whereBlock += ") ";
    }

    const list = await db
      .query(
        `
        SELECT M.idx, M.mid, M.created_time, M.is_ad, M.type, M.is_reserve, M.cnt, M.msg, M.title, M.success_cnt, M.charge, S.name AS store_name, M.user_idx, M.img_cnt
        FROM message AS M
        LEFT JOIN store AS S ON S.user_idx = M.user_idx
        WHERE 1 ${whereBlock} 
        ${orderBlock}
        LIMIT ${amount} OFFSET ${amount * (page - 1)}`
      )
      .then((result) => result[0]);

    const { total, totalFee } = await db
      .query(
        `SELECT count(M.idx) AS total, sum(M.charge) AS totalFee 
            FROM message AS M
            LEFT JOIN store AS S ON S.user_idx = M.user_idx
            WHERE 1 ${whereBlock}`
      )
      .then((result) => result[0][0]);

    return res.status(200).json({ total, totalFee, list });
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});
// 메세지 전송 내역 불러오기 ( 어드민 ) - 엑셀
router.get("/message-log-excel", isAdminAuth, async (req, res) => {
  try {
    const { start_date, end_date, type, is_ad, column, order, keyword } =
      req.query;
    let orderBlock = "";
    if (
      ["is_reserve", "type", "is_ad", "created_time", "store_name"].includes(
        column
      ) &&
      ["ASC", "DESC"].includes(order.toUpperCase())
    ) {
      orderBlock = `ORDER BY ${column} ${order} `;
    }
    let whereBlock = "";
    if (start_date) {
      whereBlock += `&& M.created_time >= '${start_date}' `;
    }
    if (end_date) {
      whereBlock += `&& M.created_time <= '${end_date}' `;
    }
    if (type) {
      whereBlock += `&& M.type = '${type.toUpperCase()}' `;
    }
    if (is_ad != null) {
      if (is_ad == 1) {
        whereBlock += `&& M.is_ad = 1 `;
      } else {
        whereBlock += `&& M.is_ad = 0 `;
      }
    }
    if (keyword) {
      whereBlock += "&& (";
      whereBlock += `M.names LIKE '%${keyword}%' `;
      whereBlock += `|| M.phones LIKE '%${keyword}%' `;
      whereBlock += `|| M.msg LIKE '%${keyword}%' `;
      whereBlock += `|| S.name LIKE '%${keyword}%'`;
      whereBlock += ") ";
    }

    const list = await db
      .execute(
        `
        SELECT M.idx, M.mid, M.created_time, M.is_ad, M.type, M.is_reserve, M.cnt, M.msg, M.success_cnt, M.charge, S.name AS store_name
        FROM message AS M
        LEFT JOIN store AS S ON S.user_idx = M.user_idx
        WHERE 1 ${whereBlock} 
        ${orderBlock}`
      )
      .then((result) => result[0]);

    return res.status(200).json({ list });
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

// 지공차트 목록
router.get(
  "/drilling-chart-list",
  isAdminAuth,
  [
    query("name").notEmpty().withMessage("이름을 입력해 주세요."),
    query("phone").notEmpty().withMessage("핸드폰 번호를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { name, phone } = req.query;
      const chartList = await db
        .execute(
          `SELECT store.type, store.name, drilling_chart.idx, drilling_chart.customer_idx, drilling_chart.chart_number, drilling_chart.chart_name, drilling_chart.ball_name, drilling_chart.weight, drilling_chart.layout, drilling_chart.pin, driller.name AS driller, drilling_chart.memo, drilling_chart.created_time, drilling_chart.updated_time FROM drilling_chart JOIN driller ON drilling_chart.driller_idx=driller.idx JOIN store ON drilling_chart.user_idx=store.user_idx JOIN customer ON drilling_chart.customer_idx=customer.idx WHERE customer.name='${name}'&&customer.phone='${phone}'&&drilling_chart.deleted_time IS NULL ORDER BY idx DESC`
        )
        .then((result) => result[0]);
      res.status(200).json(chartList);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 지공사 목록
router.get("/driller", isAdminAuth, async (req, res) => {
  try {
    const { idx } = req.query;
    console.log(idx);
    const user_idx = await db
      .execute(`SELECT * FROM drilling_chart WHERE idx=${idx}`)
      .then((result) => result[0][0].user_idx);
    const driller = await db
      .execute(`SELECT * FROM driller WHERE user_idx=${user_idx} `)
      .then((result) => result[0]);
    res.status(200).json(driller);
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

// 이용권 정보 불러오기
router.get("/payment-setting", isAuth, async (req, res) => {
  try {
    const paymentInfo = await db
      .execute(`SELECT name, amount FROM payment_setting WHERE idx=1`)
      .then((result) => result[0][0]);
    res.status(200).json(paymentInfo);
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

// 이용권 정보 설정
router.put(
  "/payment-setting",
  isAdminAuth,
  [
    body("name").trim().notEmpty().withMessage("상품명을 입력해 주세요."),
    body("amount").trim().notEmpty().withMessage("금액을 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { name, amount } = req.body;
      await db.execute(
        `UPDATE payment_setting SET name='${name}', amount=${amount} WHERE idx=1`
      );
      res.sendStatus(204);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 결제 현황 & 결제 내역
router.get("/payment", isAdminAuth, async (req, res) => {
  try {
    const {
      start_date,
      end_date,
      keyword,
      page,
      column = "paymentIdx",
      order = "DESC",
    } = req.query;
    const amount = req.query.amount ?? 10;

    // -> 결제 현황
    const summary = await db
      .execute(
        `SELECT 
          SUM(amount) AS totalAmount, 
          COUNT(idx) AS totalCount,
          (
            SELECT 
              SUM(payment_refund.amount) 
            FROM payment_refund 
            JOIN payment_history ON payment_refund.idx=payment_history.refund_idx 
            WHERE 
              payment_history.refund_idx IS NOT NULL 
              AND payment_history.is_default=0
            ) as totalRefund 
          FROM payment_history
          WHERE payment_history.is_default=0`
      )
      .then((result) => result[0][0]);
    const totalData = {
      totalAmount: summary.totalAmount ? summary.totalAmount : 0,
      totalCount: summary.totalCount ? summary.totalCount : 0,
      totalRefund: summary.totalRefund ? summary.totalRefund : 0,
    };
    const total = await db
      .execute(
        `SELECT 
              COUNT(payment_history.idx) AS total 
            FROM payment_history 
            LEFT JOIN user ON payment_history.user_idx=user.idx 
            LEFT JOIN store ON store.user_idx=user.idx 
            LEFT JOIN payment_refund ON payment_history.refund_idx=payment_refund.idx 
            WHERE 
            payment_history.is_default=0 
            ${
              keyword
                ? `AND (store.name LIKE '%${keyword}%'|| user.name LIKE '%${keyword}%')`
                : ""
            }
            ${
              start_date && end_date
                ? `AND payment_history.paid_time BETWEEN '${start_date}' AND '${dayjs(
                    end_date
                  )
                    .add(1, "day")
                    .format("YYYY-MM-DD")}'`
                : ""
            }`
      )
      .then((result) => result[0][0].total);
    const paymentList = await db
      .execute(
        `SELECT 
              payment_history.idx AS paymentIdx, 
              store.type AS storeType, 
              store.name AS storeName, 
              user.name AS userName, 
              payment_history.paid_time, 
              payment_history.start_date, 
              payment_history.end_date, 
              payment_history.amount AS paymentAmount, 
              payment_refund.amount AS refundAmount, 
              payment_refund.memo AS refundMemo, 
              (
                SELECT COUNT(idx) 
                FROM talk_log 
                where user.idx=talk_log.user_idx 
                  AND talk_log.created_time BETWEEN payment_history.start_date AND payment_history.end_date 
                group by user_idx 
              ) AS talkCount 
              FROM payment_history 
              LEFT JOIN user ON payment_history.user_idx=user.idx 
              LEFT JOIN store ON store.user_idx=user.idx 
              LEFT JOIN payment_refund ON payment_history.refund_idx=payment_refund.idx 
              WHERE 
              payment_history.is_default=0 
              ${
                keyword
                  ? `AND (store.name LIKE '%${keyword}%'|| user.name LIKE '%${keyword}%')`
                  : ""
              }
              ${
                start_date && end_date
                  ? `AND payment_history.paid_time BETWEEN '${start_date}' AND '${dayjs(
                      end_date
                    )
                      .add(1, "day")
                      .format("YYYY-MM-DD")}'`
                  : ""
              }
              ORDER BY ${column} ${order}  
              LIMIT ${amount} OFFSET ${amount * (page - 1)}`
      )
      .then((result) => result[0]);
    const sumData = await db
      .execute(
        `SELECT 
            SUM(talkCount) AS totalTalk,
            SUM(paymentAmount) AS totalAmount,
            SUM(refundAmount) AS totalRefund
            FROM (SELECT 
            payment_history.idx AS paymentIdx, 
            store.type AS storeType, 
            store.name AS storeName, 
            user.name AS userName, 
            payment_history.paid_time, 
            payment_history.start_date, 
            payment_history.end_date, 
            payment_history.amount AS paymentAmount, 
            payment_refund.amount AS refundAmount, 
            payment_refund.memo AS refundMemo, 
            (
              SELECT COUNT(idx) 
              FROM talk_log 
              where user.idx=talk_log.user_idx 
                AND talk_log.created_time BETWEEN payment_history.start_date AND payment_history.end_date 
              group by user_idx 
            ) AS talkCount 
            FROM payment_history 
            LEFT JOIN user ON payment_history.user_idx=user.idx 
            LEFT JOIN store ON store.user_idx=user.idx 
            LEFT JOIN payment_refund ON payment_history.refund_idx=payment_refund.idx 
            WHERE 
              payment_history.is_default=0 
              ${
                keyword
                  ? `AND (store.name LIKE '%${keyword}%'|| user.name LIKE '%${keyword}%')`
                  : ""
              }
              ${
                start_date && end_date
                  ? `AND payment_history.paid_time BETWEEN '${start_date}' AND '${dayjs(
                      end_date
                    )
                      .add(1, "day")
                      .format("YYYY-MM-DD")}'`
                  : ""
              }
            ) AS Main`
      )
      .then((result) => result[0][0]);
    res.status(200).json({ totalData, paymentList, total, sumData });
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

// [엑셀 다운로드용] 결제 내역
router.get("/payment-excel", isAdminAuth, async (req, res) => {
  try {
    const {
      start_date,
      end_date,
      keyword,
      column = "paymentIdx",
      order = "DESC",
    } = req.query;
    const paymentList = await db
      .execute(
        `SELECT 
              payment_history.idx AS paymentIdx, 
              store.type AS storeType, 
              store.name AS storeName, 
              user.name AS userName, 
              payment_history.paid_time, 
              payment_history.start_date, 
              payment_history.end_date, 
              payment_history.amount AS paymentAmount, 
              payment_refund.amount AS refundAmount, 
              payment_refund.memo AS refundMemo, 
              (
                SELECT COUNT(idx) 
                FROM talk_log 
                where user.idx=talk_log.user_idx 
                  AND talk_log.created_time BETWEEN payment_history.start_date AND payment_history.end_date 
                group by user_idx 
              ) AS talkCount 
              FROM payment_history 
              LEFT JOIN user ON payment_history.user_idx=user.idx 
              LEFT JOIN store ON store.user_idx=user.idx 
              LEFT JOIN payment_refund ON payment_history.refund_idx=payment_refund.idx 
              WHERE 
              payment_history.is_default=0 
              ${
                keyword
                  ? `AND (store.name LIKE '%${keyword}%'|| user.name LIKE '%${keyword}%')`
                  : ""
              }
              ${
                start_date && end_date
                  ? `AND payment_history.paid_time BETWEEN '${start_date}' AND '${dayjs(
                      end_date
                    )
                      .add(1, "day")
                      .format("YYYY-MM-DD")}'`
                  : ""
              }
              ORDER BY ${column} ${order}`
      )
      .then((result) => result[0]);
    res.status(200).json(paymentList);
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

// 취소/환불 처리 (+수정)
router.put(
  "/payment",
  isAdminAuth,
  [
    body("payment_idx")
      .trim()
      .notEmpty()
      .withMessage("payment_idx를 입력해 주세요."),
    body("amount").trim().notEmpty().withMessage("금액을 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { payment_idx, amount, memo } = req.body;
      const today = dayjs().format("YYYY-MM-DD HH:mm:ss");
      const foundRefund = await db
        .execute(
          `SELECT * FROM payment_history WHERE idx=${payment_idx}&&refund_idx IS NOT NULL`
        )
        .then((result) => {
          console.log("result", result[0]);
          return result[0].length > 0 ? result[0][0].refund_idx : null;
        });
      console.log("foundrefund", foundRefund);
      if (foundRefund) {
        await db.execute(
          "UPDATE payment_refund SET amount=?, memo=? WHERE idx=?",
          [amount, memo == "null" ? "" : memo, foundRefund]
        );
        res.sendStatus(201);
      } else {
        const result = await db.execute(
          "INSERT INTO payment_refund ( amount, memo, refund_time ) VALUES (?,?,?)",
          [amount, memo, today]
        );
        const insertId = result[0].insertId;
        const userIdx = await db
          .execute(
            `SELECT user_idx FROM payment_history WHERE idx=${payment_idx}`
          )
          .then((result) => result[0][0].user_idx);
        await db.execute(
          `UPDATE payment_history SET refund_idx=${insertId} WHERE idx=${payment_idx}`
        );

        const now = dayjs().format("YYYY-MM-DD");
        const isTicketExist = await db
          .query(
            `SELECT idx, start_date, end_date FROM payment_history WHERE user_idx=${userIdx} AND start_date <= '${now}' AND end_date >= '${now}' AND idx != ${payment_idx} AND refund_idx IS NULL AND is_default=0`
          )
          .then((r) => r[0][0]);

        if (!isTicketExist) {
          const isFreeExist = await db
            .query(
              `SELECT idx FROM payment_history WHERE user_idx=${userIdx} AND start_date = '${now}' AND is_default=1`
            )
            .then((r) => r[0][0]);
          const afterTicket = await db
            .query(
              `SELECT start_date, end_date FROM payment_history WHERE user_idx=${userIdx} AND start_date > '${now}' AND idx != ${payment_idx} AND refund_idx IS NULL ORDER BY start_date ASC LIMIT 1`
            )
            .then((r) => r[0][0]);
          const newEndDate = afterTicket
            ? dayjs(afterTicket.start_date)
                .subtract(1, "day")
                .format("YYYY-MM-DD")
            : null;

          // 무료 이용권 생성
          if (isFreeExist) {
            await db.execute(
              "UPDATE payment_history SET end_date=? WHERE idx=?",
              [newEndDate, isFreeExist.idx]
            );
          } else {
            await db.execute(
              "INSERT INTO payment_history (user_idx, payment_name, is_default, amount, paid_time, start_date, end_date) VALUES (?,?,?,?,?,?,?)",
              [
                userIdx,
                "무료",
                1,
                0,
                new Date(),
                dayjs().format("YYYY-MM-DD"),
                newEndDate,
              ]
            );
          }

          await db.execute(`UPDATE user SET grade=0 WHERE idx=${userIdx}`);
          await db.execute(
            `UPDATE talk_dday SET deleted_time='${today}' WHERE user_idx=${userIdx}&&dday!=3`
          );
        }
        res.sendStatus(201);
      }
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 광고 배너 수정
router.post(
  "/banner",
  isAdminAuth,
  upload.fields([{ name: "image1" }, { name: "image2" }]),
  async (req, res) => {
    try {
      const { type, idxs } = req.body;
      for (const idx of idxs) {
        const location = `${type}${idx}`;
        const link = req.body[`link${idx}`];
        const image = req.files[`image${idx}`]
          ? req.files[`image${idx}`][0]
          : req.body[`image${idx}`];
        const show = req.body[`show${idx}`];
        console.log("데이터 ::: ", location, link, image.filename, show);
        const find = await db
          .execute(`SELECT idx FROM advertising WHERE location='${location}'`)
          .then((result) => result[0][0]);
        if (find) {
          if (typeof image === "string") {
            await db.execute(
              `UPDATE advertising SET link='${link}', visible=${show} WHERE idx=${find.idx}`
            );
          } else {
            await db.execute(
              `UPDATE advertising SET image='${image.filename}', link='${link}', visible=${show} WHERE idx=${find.idx}`
            );
          }
        } else {
          await db.execute(
            "INSERT INTO advertising (location, image, link, visible ) VALUES (?,?,?,?)",
            [location, image.filename, link, show]
          );
        }
      }
      res.sendStatus(204);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 광고 배너 데이터
router.get("/banner", isAuth, async (req, res) => {
  try {
    const types = ["locker", "customer", "setting"];
    let data = {};
    for (const type of types) {
      const banners = await db
        .execute(`SELECT * FROM advertising WHERE location like'${type}%'`)
        .then((result) => result[0]);
      // console.log("banners", banners);
      if (banners.length > 0) {
        for (const banner of banners) {
          const idx = banner.location.split(type)[1];
          // console.log(idx);
          const bannerList = {
            [idx]: {
              link: banner.link,
              image: `${URI ? URI : "http://localhost:4000"}/uploads/${
                banner.image
              }`,
              show: banner.visible,
            },
          };
          data = { ...data, [type]: { ...data[type], ...bannerList } };
        }
      }
    }
    res.status(200).json(data);
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

// 회원 정보로 메모 불러오기 (라커 이용자 추가 시 사용)
router.post(
  "/customer-memo",
  isAuth,
  [
    body("user_idx").trim().notEmpty().withMessage("user_idx를 입력해 주세요."),
    body("phone").trim().notEmpty().withMessage("phone을 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { user_idx, name, phone } = req.body;
      const user = await db
        .execute(
          `SELECT memo FROM customer WHERE user_idx=${user_idx}&&phone='${phone}'&&deleted_time IS NULL`
        )
        .then((result) => result[0][0]);
      console.log(name, phone, user_idx, user);
      if (user) {
        res.status(200).json(user.memo);
      } else {
        res.sendStatus(400);
      }
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

/**
 * 메모 관련
 */

// 가맹점 메모 불러오기
router.get(
  "/user-memo",
  isAdminAuth,
  [
    query("user_idx")
      .trim()
      .notEmpty()
      .withMessage("회원(가맹점주)의 idx를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { user_idx, page = 1 } = req.query;
      const memos = await db
        .execute(
          `SELECT * FROM user_memo WHERE user_idx=${user_idx} ORDER BY created_time DESC LIMIT 10 OFFSET ${
            10 * (page - 1)
          }`
        )
        .then((result) => result[0]);
      const total = await db
        .execute(
          `SELECT count(idx) AS total FROM user_memo WHERE user_idx=${user_idx}`
        )
        .then((result) => result[0][0].total);
      if (memos) {
        res.status(200).json({ memos, total });
      } else {
        res.sendStatus(400);
      }
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 가맹점 메모 등록
router.post(
  "/user-memo",
  isAdminAuth,
  [
    body("user_idx")
      .trim()
      .notEmpty()
      .withMessage("회원(가맹점주)의 idx를 입력해 주세요."),
    body("memo").trim().notEmpty().withMessage("메모 내용을 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { user_idx, memo } = req.body;
      const user = await db
        .execute(
          `SELECT idx FROM user WHERE idx=${user_idx} && deleted_time IS NULL`
        )
        .then((result) => result[0][0]);
      if (!user) {
        res.status(404).json({ message: "해당 가맹점이 존재하지 않습니다." });
        return;
      }
      await db.execute(`INSERT INTO user_memo (user_idx, memo) VALUES (?,?);`, [
        user_idx,
        memo,
      ]);
      res.sendStatus(201);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 가맹점 메모 삭제
router.post(
  "/user-memo-delete",
  isAdminAuth,
  [
    body("user_idx")
      .trim()
      .notEmpty()
      .withMessage("회원(가맹점주)의 idx를 입력해 주세요."),
    body("idx").trim().notEmpty().withMessage("메모 idx를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { user_idx, idx } = req.body;
      const memo = await db
        .execute(
          `SELECT idx FROM user_memo WHERE idx=${idx} && user_idx=${user_idx}`
        )
        .then((result) => result[0][0]);
      if (!memo) {
        res.status(404).json({ message: "해당 메모가 존재하지 않습니다." });
        return;
      }
      await db.execute(`DELETE FROM user_memo WHERE idx=${idx}`);
      res.sendStatus(204);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 이용권 만료 임박 목록
router.get("/payment-expire-list", isAdminAuth, async (req, res) => {
  try {
    const { page = 1 } = req.query;
    const amount = req.query.amount ?? 5;
    const thirtyDaysAfter = dayjs().add(31, "day").format("YYYY-MM-DD");
    const now = dayjs().format("YYYY-MM-DD");
    const total = await db
      .query(
        `
        SELECT
          COUNT(PH.idx) AS total
        FROM user AS U
        JOIN store AS S ON S.user_idx = U.idx
        JOIN (
        SELECT PH1.idx, PH1.user_idx, PH1.start_date, PH1.end_date
        FROM payment_history AS PH1
        JOIN (
          SELECT user_idx, MAX(end_date) AS end_date
          FROM payment_history
          GROUP BY user_idx
          ) AS PH2 ON PH1.user_idx = PH2.user_idx AND PH1.end_date = PH2.end_date
          WHERE 
            PH1.end_date <= '${thirtyDaysAfter}' 
            AND PH1.start_date <= '${now}'
            AND PH1.refund_idx IS NULL
            AND PH1.no_list = 0
            AND PH1.is_default = 0
          GROUP BY PH1.idx, PH1.user_idx, PH1.start_date, PH1.end_date
        ) AS PH ON PH.user_idx = U.idx
      `
      )
      .then((result) => result[0][0].total);

    const list = await db
      .query(
        `
        SELECT
          PH.idx AS idx, S.name AS name, PH.start_date, PH.end_date AS end_date, U.phone AS phone
        FROM user AS U
        JOIN store AS S ON S.user_idx = U.idx
        JOIN (
        SELECT PH1.idx, PH1.user_idx, PH1.start_date, PH1.end_date
        FROM payment_history AS PH1
        JOIN (
          SELECT user_idx, MAX(end_date) AS end_date
          FROM payment_history
          GROUP BY user_idx
          ) AS PH2 ON PH1.user_idx = PH2.user_idx AND PH1.end_date = PH2.end_date
          WHERE 
            PH1.end_date <= '${thirtyDaysAfter}' 
            AND PH1.start_date <= '${now}'
            AND PH1.refund_idx IS NULL
            AND PH1.no_list = 0
            AND PH1.is_default = 0
          GROUP BY PH1.idx, PH1.user_idx, PH1.start_date, PH1.end_date
        ) AS PH ON PH.user_idx = U.idx
        ORDER BY PH.end_date ASC
        LIMIT ${amount} OFFSET ${amount * (page - 1)}
        `
      )
      .then((result) =>
        result[0]?.map((row) => {
          row.period = dayjs(row.end_date).diff(row.start_date, "days") + 1;
          return row;
        })
      );
    return res.status(200).json({ total, list });
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

router.post(
  "/payment-expire-delete",
  isAdminAuth,
  [body("idx").trim().notEmpty().withMessage("idx를 입력해주세요"), validate],
  async (req, res) => {
    try {
      const { idx } = req.body;
      const isExist = await db
        .execute(`SELECT idx FROM payment_history WHERE idx=${idx}`)
        .then((r) => r[0][0]);
      if (!isExist) {
        res.status(404).json({ message: "해당 기록이 존재하지 않습니다." });
        return;
      }
      await db.execute(
        `UPDATE payment_history SET no_list = 1 WHERE idx=${idx}`
      );
      res.sendStatus(204);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 개인 정보 조회 (어드민)
router.get(
  "/user-info",
  isAdminAuth,
  [
    query("user_idx")
      .trim()
      .notEmpty()
      .withMessage("가맹점 idx를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { user_idx } = req.query;
      const user = await db
        .query(
          `SELECT idx, name, email, agree_marketing, phone FROM user WHERE idx=${user_idx}`
        )
        .then((r) => r[0][0]);
      if (!user) {
        res.status(400).json({ message: "해당 유저가 존재하지 않습니다." });
        return;
      }
      res.status(200).json(user);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 개인 정보 수정 (어드민)
router.put(
  "/user-info",
  isAdminAuth,
  [
    body("user_idx")
      .trim()
      .notEmpty()
      .withMessage("가맹점 idx를 입력해 주세요."),
    body("name").trim().notEmpty().withMessage("이름을 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { user_idx, name, agree_marketing, email, phone } = req.body;
      console.log(user_idx, name, agree_marketing, email, phone);
      if (email) {
        const existEmail = await db
          .query(
            `SELECT idx FROM user WHERE email='${email}' AND idx != ${user_idx} AND idx != 1`
          )
          .then((r) => r[0][0]);
        if (existEmail) {
          res.status(409).json({ message: "이미 존재하는 이메일입니다." });
          return;
        }
      }

      const entries = Object.entries({
        name,
        email,
        phone,
        agree_marketing,
      }).filter(([_, v]) => v != null);

      await db.execute(
        `UPDATE user SET ${entries
          .map(([k]) => `${k}=?`)
          .join(", ")} WHERE idx=?`,
        [...entries.map(([_, v]) => v), user_idx]
      );
      console.log(
        `UPDATE user SET ${entries
          .map(([k]) => `${k}=?`)
          .join(", ")} WHERE idx=?`,
        [...entries.map(([_, v]) => v), user_idx]
      );

      res.sendStatus(204);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 사업자 정보 조회 (어드민)
router.get(
  "/business-info",
  isAdminAuth,
  [
    query("user_idx")
      .trim()
      .notEmpty()
      .withMessage("가맹점 idx를 입력해 주세요"),
    validate,
  ],
  async (req, res) => {
    try {
      const { user_idx } = req.query;
      const info = await db
        .query(`SELECT * FROM business_info WHERE user_idx=${user_idx}`)
        .then((r) => r[0][0] ?? {});

      let payment = await db
        .query(
          `
          SELECT
            start_date,
            end_date
          FROM payment_history
          WHERE
              user_idx = ${user_idx}
              AND refund_idx IS NULL
          ORDER BY idx DESC
          LIMIT 1
          `
        )
        .then((result) => result[0][0]);
      if (!payment) {
        const createdTime = await db
          .query(`SELECT created_time FROM user where idx=${user_idx}`)
          .then((r) => r[0][0].created_time);
        payment = { start_date: createdTime, end_date: null };
      }

      res.status(200).json({ info, payment });
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 사업자 정보 수정 (어드민)
router.put(
  "/business-info",
  isAdminAuth,
  upload.array("images", 3),
  [
    body("user_idx")
      .trim()
      .notEmpty()
      .withMessage("가맹점 idx를 입력해 주세요"),
    body("company_name")
      .trim()
      .notEmpty()
      .withMessage("사업자명을 입력해 주세요"),
    validate,
  ],
  async (req, res) => {
    try {
      const { user_idx, company_name, ceo_name, business_number, ceo_phone } =
        req.body;
      const images = req.files?.map((f) => f.filename) ?? null;

      const existUser = await db
        .query(`SELECT idx FROM user WHERE idx = ${user_idx}`)
        .then((r) => r[0][0]);
      if (!existUser) {
        res.status(404).json({ message: "해당 유저가 존재하지 않습니다." });
        return;
      }

      const exist = await db
        .query(
          `SELECT user_idx FROM business_info WHERE user_idx = ${user_idx}`
        )
        .then((r) => r[0][0]);
      if (exist) {
        await db.execute(
          `UPDATE business_info SET company_name=?, ceo_name=?, business_number=?, ceo_phone=?, registration_images=? WHERE user_idx = ?`,
          [company_name, ceo_name, business_number, ceo_phone, images, user_idx]
        );
      } else {
        await db.execute(
          `INSERT INTO business_info (user_idx, company_name, ceo_name, business_number, ceo_phone, registration_images) VALUES (?,?,?,?,?,?)`,
          [user_idx, company_name, ceo_name, business_number, ceo_phone, images]
        );
      }
      res.sendStatus(204);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 시설 정보 조회 (어드민))
router.get(
  "/store-info",
  isAdminAuth,
  [
    query("store_idx")
      .trim()
      .notEmpty()
      .withMessage("시설 idx를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { store_idx } = req.query;
      const user = await db
        .query(
          `SELECT idx, type, name, zip_code, address1, address2, contact, (SELECT COUNT(idx) FROM user_memo WHERE user_memo.user_idx=store.user_idx) AS memo_cnt FROM store WHERE idx=${store_idx}`
        )
        .then((r) => r[0][0]);
      if (!user) {
        res.status(400).json({ message: "해당 유저가 존재하지 않습니다." });
        return;
      }
      res.status(200).json(user);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 시설 정보 수정 (어드민)
router.put(
  "/store-info",
  isAdminAuth,
  [
    body("store_idx")
      .trim()
      .notEmpty()
      .withMessage("시설 idx를 입력해 주세요."),
    body("type").trim().notEmpty().withMessage("시설 유형을 입력해 주세요."),
    body("name").trim().notEmpty().withMessage("시설 이름을 입력해 주세요."),
    body("zip_code")
      .trim()
      .notEmpty()
      .withMessage("우편 번호를 입력해 주세요."),
    body("address1").trim().notEmpty().withMessage("주소를 입력해 주세요."),
    body("address2")
      .trim()
      .notEmpty()
      .withMessage("상세 주소를 입력해 주세요."),
    body("contact")
      .trim()
      .notEmpty()
      .withMessage("시설 연락처를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { store_idx, type, name, zip_code, address1, address2, contact } =
        req.body;
      await db.execute(
        "UPDATE store SET type=?, name=?, zip_code=?, address1=?, address2=?, contact=? WHERE idx=?",
        [type, name, zip_code, address1, address2, contact, store_idx]
      );
      res.status(200).json({ message: "시설 정보가 변경되었습니다." });
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 이용권 수정
router.put(
  "/payment-current",
  isAdminAuth,
  [
    body("payment_idx")
      .trim()
      .notEmpty()
      .withMessage("이용권의 idx를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const {
        payment_idx,
        payment_name,
        amount,
        paid_time,
        start_date,
        end_date,
      } = req.body;
      const f_start_date = dayjs(start_date).format("YYYY-MM-DD");
      const f_end_date = dayjs(end_date).format("YYYY-MM-DD");
      const user_idx = await db
        .query(
          `SELECT user_idx FROM payment_history WHERE idx = ${payment_idx}`
        )
        .then((r) => r[0][0]?.user_idx);

      if (!user_idx) {
        res.status(401).json({ message: "권한이 없습니다." });
        return;
      }
      const exist = await db
        .query(
          `SELECT idx FROM payment_history WHERE user_idx=${user_idx} AND refund_idx IS NULL AND is_default = 0 AND (start_date BETWEEN '${f_start_date}' AND '${f_end_date}' OR end_date BETWEEN '${f_start_date}' AND '${f_end_date}')`
        )
        .then((r) => r[0]);

      if (exist?.length > 0 && exist[0].idx != payment_idx) {
        res.status(409).json({ message: "중복된 기간이 존재합니다." });
        return;
      }

      const entries = Object.entries({
        payment_name,
        amount,
        paid_time,
        start_date,
        end_date,
      }).filter(([_, v]) => v != null);

      await db.execute(
        `UPDATE payment_history SET ${entries
          .map(([k, v]) => `${k}=?`)
          .join(", ")} WHERE idx=?`,
        [...entries.map(([_, v]) => v), payment_idx]
      );

      const existFree = await db
        .query(
          `SELECT start_date FROM payment_history WHERE user_idx=${user_idx} AND is_default=1 AND end_date IS NULL ORDER BY start_date DESC LIMIT 1`
        )
        .then((r) => r[0][0]);

      if (
        existFree &&
        dayjs(start_date).diff(existFree.start_date, "day") >= 1
      ) {
        // 무료 이용권 만료
        await db.execute(
          "UPDATE payment_history SET end_date=? WHERE user_idx=? AND is_default=1 AND end_date IS NULL",
          [dayjs(start_date).subtract(1, "day").format("YYYY-MM-DD"), user_idx]
        );
      }

      await db.execute(
        `DELETE FROM payment_history WHERE is_default=1 AND user_idx=${user_idx} AND start_date BETWEEN '${f_start_date}' AND '${f_end_date}' AND (end_date IS NULL OR end_date BETWEEN '${f_start_date}' AND '${f_end_date}')`
      );
      res.sendStatus(204);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 결제 등록이었는데, 이거 안이용해도 될듯
router.post(
  "/payment-current",
  isAdminAuth,
  [
    body("user_idx")
      .trim()
      .notEmpty()
      .withMessage("가맹점의 idx를 입력해 주세요."),
    body("payment_name")
      .trim()
      .notEmpty()
      .withMessage("이용권 이름을 입력해 주세요."),
    body("amount")
      .trim()
      .notEmpty()
      .withMessage("이용권 금액을 입력해 주세요."),
    body("paid_time")
      .trim()
      .notEmpty()
      .withMessage("거래 날짜를 입력해 주세요."),
    body("start_date")
      .trim()
      .notEmpty()
      .withMessage("이용기간(시작일)을 입력해 주세요."),
    body("end_date")
      .trim()
      .notEmpty()
      .withMessage("이용기간(종료일)을 입력해 주세요."),
  ],
  async (req, res) => {
    try {
      const {
        user_idx,
        payment_name,
        amount,
        paid_time,
        start_date,
        end_date,
        imp_uid = "",
        merchant_uid = "",
        card_name = "",
        card_number = "",
        receipt_url = "",
      } = req.body;
      const f_start_date = dayjs(start_date).format("YYYY-MM-DD");
      const f_end_date = dayjs(end_date).format("YYYY-MM-DD");

      const exist = await db
        .query(
          `SELECT idx FROM payment_history WHERE user_idx=${user_idx} AND refund_idx IS NULL AND is_default = 0 AND (start_date BETWEEN '${f_start_date}' AND '${f_end_date}' OR end_date BETWEEN '${f_start_date}' AND '${f_end_date}')`
        )
        .then((r) => r[0]);

      if (exist?.length > 0) {
        res.status(409).json({ message: "중복된 기간이 존재합니다." });
        return;
      }

      await db.execute(
        `INSERT INTO payment_history (
          user_idx,
          payment_name,
          amount,
          paid_time,
          start_date,
          end_date,
          imp_uid,
          merchant_uid,
          card_name,
          card_number,
          receipt_url
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          user_idx,
          payment_name,
          amount ? amount : 0,
          paid_time,
          start_date,
          end_date,
          imp_uid,
          merchant_uid,
          card_name,
          card_number,
          receipt_url,
        ]
      );
      const existFree = await db
        .query(
          `SELECT start_date FROM payment_history WHERE user_idx=${user_idx} AND is_default=1 AND end_date IS NULL ORDER BY start_date DESC LIMIT 1`
        )
        .then((r) => r[0][0]);

      if (
        existFree &&
        dayjs(start_date).diff(existFree.start_date, "day") >= 1
      ) {
        // 무료 이용권 만료
        await db.execute(
          "UPDATE payment_history SET end_date=? WHERE user_idx=? AND is_default=1 AND end_date IS NULL",
          [dayjs(start_date).subtract(1, "day").format("YYYY-MM-DD"), user_idx]
        );
      }

      await db.execute(
        `DELETE FROM payment_history WHERE is_default=1 AND user_idx=${user_idx} AND start_date BETWEEN '${f_start_date}' AND '${f_end_date}' AND (end_date IS NULL OR end_date BETWEEN '${f_start_date}' AND '${f_end_date}')`
      );
      await db.execute(`UPDATE user SET grade=1 WHERE idx=${user_idx}`);
      await db.execute(
        `UPDATE talk_dday SET deleted_time=NULL WHERE user_idx=${user_idx}&&dday!=3`
      );

      res.sendStatus(204);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 메세지 전송 내역 (수익관리)
router.get("/message-stats", isAdminAuth, async (req, res) => {
  const amount = 10;
  try {
    const {
      start_date,
      end_date,
      column = "idx",
      order = "DESC",
      keyword,
      page = 1,
    } = req.query;
    let orderBlock = "";
    if (
      [
        "store_name",
        "name",
        "sms_cnt",
        "sms_charge",
        "lms_cnt",
        "lms_charge",
        "mms_cnt",
        "mms_charge",
        "total_cnt",
        "total_charge",
        "first_used",
        "recent_used",
      ].includes(column) &&
      ["ASC", "DESC"].includes(order.toUpperCase())
    ) {
      orderBlock = `ORDER BY ${column} ${order} `;
    }
    let whereBlock = "";
    if (start_date) {
      whereBlock += `&& M.created_time >= '${start_date}' `;
    }
    if (end_date) {
      whereBlock += `&& M.created_time <= '${dayjs(end_date)
        .add(1, "day")
        .format("YYYY-MM-DD")}' `;
    }

    if (keyword) {
      whereBlock += "&& (";
      whereBlock += `U.name LIKE '%${keyword}%' `;
      whereBlock += `|| S.name LIKE '%${keyword}%'`;
      whereBlock += ") ";
    }

    const list = await db
      .query(
        `
        SELECT *, (sms_cnt + lms_cnt + mms_cnt) AS total_cnt, (sms_charge + lms_charge + mms_charge) AS total_charge, (SELECT MIN(created_time) FROM message WHERE user_idx = Main.user_idx) AS first_used, (SELECT MAX(created_time) FROM message WHERE user_idx = Main.user_idx) AS recent_used
        FROM (SELECT 
            M.user_idx,
            ANY_VALUE(S.name) AS store_name,
            ANY_VALUE(U.name) AS name,
            SUM(IF(M.type = 'SMS', M.success_cnt, 0)) AS sms_cnt,
            SUM(IF(M.type = 'SMS', M.charge, 0)) AS sms_charge,
            SUM(IF(M.type = 'LMS', M.success_cnt, 0)) AS lms_cnt,
            SUM(IF(M.type = 'LMS', M.charge, 0)) AS lms_charge,
            SUM(IF(M.type = 'MMS', M.success_cnt, 0)) AS mms_cnt,
            SUM(IF(M.type = 'MMS', M.charge, 0)) AS mms_charge
        FROM message AS M
        LEFT JOIN user AS U ON M.user_idx = U.idx
        LEFT JOIN store AS S ON S.user_idx = M.user_idx	
        WHERE 1 ${whereBlock} 
        GROUP BY M.user_idx
        ) AS Main
        ${orderBlock}
        LIMIT ${amount} OFFSET ${amount * (page - 1)}`
      )
      .then((result) =>
        result[0].map((row) => ({
          ...row,
          first_used: dayjs(row.first_used).format("YYYY-MM-DD"),
          recent_used: dayjs(row.recent_used).format("YYYY-MM-DD"),
          sms_cnt: parseFloat(row.sms_cnt ?? 0),
          sms_charge: parseFloat(row.sms_charge ?? 0),
          lms_cnt: parseFloat(row.lms_cnt ?? 0),
          lms_charge: parseFloat(row.lms_charge ?? 0),
          mms_cnt: parseFloat(row.mms_cnt ?? 0),
          mms_charge: parseFloat(row.mms_charge ?? 0),
          total_cnt: parseFloat(row.total_cnt ?? 0),
          total_charge: parseFloat(row.total_charge ?? 0),
        }))
      );

    const sumData = list.reduce(
      (acc, cur) => {
        acc.sms_cnt += cur.sms_cnt * 10;
        acc.sms_charge += cur.sms_charge * 10;
        acc.lms_cnt += cur.lms_cnt * 10;
        acc.lms_charge += cur.lms_charge * 10;
        acc.mms_cnt += cur.mms_cnt * 10;
        acc.mms_charge += cur.mms_charge * 10;
        acc.total_cnt += cur.total_cnt * 10;
        acc.total_charge += cur.total_charge * 10;
        return acc;
      },
      {
        sms_cnt: 0,
        sms_charge: 0,
        lms_cnt: 0,
        lms_charge: 0,
        mms_cnt: 0,
        mms_charge: 0,
        total_cnt: 0,
        total_charge: 0,
      }
    );
    sumData.sms_cnt /= 10;
    sumData.sms_charge /= 10;
    sumData.lms_cnt /= 10;
    sumData.lms_charge /= 10;
    sumData.mms_cnt /= 10;
    sumData.mms_charge /= 10;
    sumData.total_cnt /= 10;
    sumData.total_charge /= 10;

    const { total } = await db
      .query(
        `SELECT 
        count(DISTINCT M.user_idx) AS total
      FROM message AS M
      LEFT JOIN user AS U ON M.user_idx = U.idx
      LEFT JOIN store AS S ON S.user_idx = M.user_idx	
      WHERE 1 ${whereBlock}`
      )
      .then((result) => result[0][0] ?? { total: 0 });

    const totalData = await db
      .query(
        `SELECT SUM(charge) AS charge_sum, COUNT(DISTINCT user_idx) AS user_cnt, SUM(success_cnt) AS message_cnt FROM message`
      )
      .then((r) => ({
        ...r[0][0],
        message_cnt: parseInt(r[0][0].message_cnt ?? 0),
      }));
    await db
      .query(`SELECT type, SUM(success_cnt) AS cnt FROM message GROUP BY type`)
      .then((r) => {
        r[0].forEach((row) => {
          totalData[`${row.type.toLowerCase()}_cnt`] = parseInt(row.cnt ?? 0);
        });
      });
    // console.log({ total, list, sumData, totalData });
    res.status(200).json({ total, list, sumData, totalData });
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

// 메세지 전송 내역 (수익관리) - 엑셀
router.get("/message-stats-excel", isAdminAuth, async (req, res) => {
  try {
    const {
      start_date,
      end_date,
      column = "idx",
      order = "DESC",
      keyword,
    } = req.query;
    let orderBlock = "";
    if (
      [
        "store_name",
        "name",
        "sms_cnt",
        "sms_charge",
        "lms_cnt",
        "lms_charge",
        "mms_cnt",
        "mms_charge",
        "total_cnt",
        "total_charge",
        "first_used",
        "recent_used",
      ].includes(column) &&
      ["ASC", "DESC"].includes(order.toUpperCase())
    ) {
      orderBlock = `ORDER BY ${column} ${order} `;
    }
    let whereBlock = "";
    if (start_date) {
      whereBlock += `&& M.created_time >= '${start_date}' `;
    }
    if (end_date) {
      whereBlock += `&& M.created_time <= '${dayjs(end_date)
        .add(1, "day")
        .format("YYYY-MM-DD")}' `;
    }

    if (keyword) {
      whereBlock += "&& (";
      whereBlock += `U.name LIKE '%${keyword}%' `;
      whereBlock += `|| S.name LIKE '%${keyword}%'`;
      whereBlock += ") ";
    }

    const list = await db
      .query(
        `
        SELECT *, (sms_cnt + lms_cnt + mms_cnt) AS total_cnt, (sms_charge + lms_charge + mms_charge) AS total_charge, (SELECT MIN(created_time) FROM message WHERE user_idx = Main.user_idx) AS first_used, (SELECT MAX(created_time) FROM message WHERE user_idx = Main.user_idx) AS recent_used
        FROM (SELECT 
          M.user_idx,
          ANY_VALUE(S.name) AS store_name,
            ANY_VALUE(U.name) AS name,
            SUM(IF(M.type = 'SMS', M.success_cnt, 0)) AS sms_cnt,
            SUM(IF(M.type = 'SMS', M.charge, 0)) AS sms_charge,
            SUM(IF(M.type = 'LMS', M.success_cnt, 0)) AS lms_cnt,
            SUM(IF(M.type = 'LMS', M.charge, 0)) AS lms_charge,
            SUM(IF(M.type = 'MMS', M.success_cnt, 0)) AS mms_cnt,
            SUM(IF(M.type = 'MMS', M.charge, 0)) AS mms_charge
        FROM message AS M
        LEFT JOIN user AS U ON M.user_idx = U.idx
        LEFT JOIN store AS S ON S.user_idx = M.user_idx	
        WHERE 1 ${whereBlock} 
        GROUP BY M.user_idx
        ) AS Main
        ${orderBlock}`
      )
      .then((result) =>
        result[0].map((row) => ({
          ...row,
          sms_cnt: parseInt(row.sms_cnt ?? 0),
          sms_charge: parseInt(row.sms_charge ?? 0),
          lms_cnt: parseInt(row.lms_cnt ?? 0),
          lms_charge: parseInt(row.lms_charge ?? 0),
          mms_cnt: parseInt(row.mms_cnt ?? 0),
          mms_charge: parseInt(row.mms_charge ?? 0),
          total_cnt: parseInt(row.total_cnt ?? 0),
          total_charge: parseInt(row.total_charge ?? 0),
        }))
      );

    res.status(200).json({ list });
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});
export default router;
