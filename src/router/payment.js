import dayjs from "dayjs";
import express from "express";
import { body, query } from "express-validator";
import { db } from "../db/database.js";
// import { checkUserGrade } from "../middleware/cron.js";
import { isAuth, validate } from "../middleware/functions.js";

const router = express.Router();

// 결제 시 유저(가맹점) 정보 받기
router.get("/store", isAuth, async (req, res) => {
  try {
    const userInfo = await db
      .execute(
        `SELECT user.name AS user_name, user.phone, user.email, store.address1, store.zip_code FROM store JOIN user ON store.user_idx=user.idx WHERE store.user_idx=${req.authorizedUser}`
      )
      .then((result) => result[0][0]);
    res.status(200).json(userInfo);
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

// 결제 정보 저장 & 유료 회원으로 전환
router.post("/payment", isAuth, async (req, res) => {
  try {
    const {
      imp_uid,
      merchant_uid,
      payment_name,
      amount,
      card_name,
      card_number,
      receipt_url,
      isExtension,
    } = req.body;
    const prevEndDate = !isExtension
      ? null
      : await db
          .execute(
            `SELECT end_date FROM payment_history WHERE user_idx=${req.authorizedUser} ORDER BY end_date DESC LIMIT 1`
          )
          .then((result) => result[0][0].end_date);
    await db.execute(
      "INSERT INTO payment_history (user_idx, imp_uid, merchant_uid, payment_name, amount, card_name, card_number, paid_time, start_date, end_date, receipt_url) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [
        req.authorizedUser,
        imp_uid,
        merchant_uid,
        payment_name,
        amount,
        card_name,
        card_number,
        new Date(),
        !isExtension
          ? dayjs().add(1, "day").format("YYYY-MM-DD")
          : dayjs(prevEndDate).add(1, "day").format("YYYY-MM-DD"),
        !isExtension
          ? dayjs().add(1, "year").format("YYYY-MM-DD")
          : dayjs(prevEndDate).add(1, "year").format("YYYY-MM-DD"),
        receipt_url,
      ]
    );

    if (!isExtension) {
      // 무료 이용권 만료 처리
      await db.execute(
        "UPDATE payment_history SET end_date=? WHERE user_idx=? AND is_default=1 AND end_date IS NULL",
        [dayjs().format("YYYY-MM-DD"), req.authorizedUser]
      );
    }
    await db.execute(`UPDATE user SET grade=1 WHERE idx=${req.authorizedUser}`);
    await db.execute(
      `UPDATE talk_dday SET deleted_time=NULL WHERE user_idx=${req.authorizedUser}&&dday!=3`
    );
    res
      .status(201)
      .json({ message: "유료 회원으로 변경, 알림톡 디데이 설정 복구됨." });
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

// 이용권 보유 현황 조회
router.get("/payment-current-list", isAuth, async (req, res) => {
  try {
    const user_idx =
      req.authorizedUser == 1 ? req.query.user_idx : req.authorizedUser;
    if (!user_idx || user_idx == 1) {
      res.status(500).json({ message: "가맹점 idx를 입력해 주세요." });
      return;
    }

    const now = dayjs().format("YYYY-MM-DD");
    // const total = await db
    //   .query(
    //     `
    //     SELECT
    //         count(idx) AS total
    //     FROM payment_history
    //     WHERE
    //         user_idx = ?
    //         AND refund_idx IS NULL
    //         AND (start_date >= ? OR end_date >= ?)
    //         `,
    //     [user_idx, now, now]
    //   )
    //   .then((result) => result[0][0].total);

    const list = await db
      .query(
        `
        SELECT 
          idx,
          payment_name,
          start_date,
          end_date,
          amount,
          paid_time,
          is_default
        FROM payment_history
        WHERE
          user_idx = ?
          AND refund_idx IS NULL
          AND (start_date >= ? OR end_date >= ? OR end_date IS NULL)
          ORDER BY start_date ASC
          `,
        [user_idx, now, now]
      )
      .then((result) => result[0]);

    const total = list.length;
    const range_list = list
      .filter(({ is_default }) => !is_default)
      .map(({ idx, start_date, end_date }) => ({
        idx,
        start_date,
        end_date,
      }));

    res.status(200).json({ total, list, range_list });
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

// 결제 내역(기간 검색)
router.get("/payment-user", isAuth, async (req, res) => {
  try {
    const user_idx =
      req.authorizedUser === 1 ? req.query.user_idx : req.authorizedUser;
    if (!user_idx || user_idx === 1) {
      res.status(500).json({ message: "가맹점 idx를 입력해 주세요." });
      return;
    }

    let { start_date = "1000-01-01", end_date = "9999-12-31" } = req.query;

    start_date = dayjs(start_date).startOf("year").format("YYYY-MM-DD");
    end_date = dayjs(end_date).endOf("year").format("YYYY-MM-DD");

    const records = await db
      .query(
        `SELECT 
          PH.idx, PH.payment_name, PH.amount, PH.start_date, PH.end_date, PH.paid_time, PH.refund_idx, PR.refund_time, PR.amount AS refund_amount
        FROM payment_history AS PH 
        LEFT JOIN payment_refund AS PR ON PH.refund_idx = PR.idx 
        WHERE 
          user_idx = ${user_idx} 
          AND paid_time BETWEEN '${start_date}' AND '${end_date}' 
        ORDER BY PH.paid_time DESC`
      )
      .then((r) => r[0]);

    for (let i = records.length - 1; i >= 0; i--) {
      let status = "만료됨";
      if (records[i].refund_time) {
        if (records[i].refund_amount !== records[i].amount) {
          status = "부분취소";
        } else {
          status = "취소됨";
        }
      } else if (dayjs().isBefore(records[i].start_date)) {
        status = "이용예정";
      } else if (!records[i].end_date) {
        status = "이용중";
      } else if (
        dayjs().isAfter(dayjs(records[i].start_date).startOf("day")) &&
        dayjs().isBefore(dayjs(records[i].end_date).endOf("day"))
      ) {
        status = "이용중";
      }
      delete records[i].refund_idx;
      records[i].status = status;
    }
    res.status(200).json(records);
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});
// router.get("/payment", isAuth, async (req, res) => {
//   try {
//     const { start_date, end_date } = req.query;
//     // console.log(req.query);
//     if (!(start_date && end_date)) {
//       const paymentHistory = await db
//         .execute(
//           `SELECT payment_name, paid_time,start_date,end_date, amount, receipt_url, refund_idx FROM payment_history WHERE user_idx=${req.authorizedUser} ORDER BY payment_history.idx DESC`
//         )
//         .then((result) => result[0]);
//       // console.log(paymentHistory);
//       res.status(200).json(paymentHistory);
//     } else {
//       const paymentHistory = await db
//         .execute(
//           `SELECT payment_name, paid_time,start_date,end_date,  amount, receipt_url, refund_idx FROM payment_history WHERE user_idx=${
//             req.authorizedUser
//           }&&payment_history.paid_time BETWEEN '${dayjs(
//             `${start_date}-01-01`
//           ).format("YYYY-MM-DD")}' AND '${dayjs(`${end_date}-12-31`).format(
//             "YYYY-MM-DD"
//           )}' ORDER BY payment_history.idx DESC`
//         )
//         .then((result) => result[0]);
//       res.status(200).json(paymentHistory);
//     }
//   } catch (e) {
//     console.log(e);
//     res.sendStatus(500);
//   }
// });

export default router;
