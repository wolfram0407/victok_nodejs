import dayjs from "dayjs";
import { db } from "../db/database.js";
import {
  addTagToCustomer,
  removeTagToCustomer,
  talkPush,
} from "./functions.js";

// 라커 사용일, 잔여일 재설정
export async function calculateDate() {
  const today = dayjs().format("YYYY-MM-DD");
  console.log("오늘", today);
  const lockerIdxs = await db
    .execute(
      `SELECT idx, start_date, end_date FROM locker WHERE end_date>='${today}'&&customer_idx IS NOT NULL&&deleted_time IS NULL`
    )
    .then((result) => result[0]);
  for (const item of lockerIdxs) {
    const used =
      dayjs(today).diff(item.start_date, "day") >= 0
        ? dayjs(today).diff(dayjs(item.start_date), "day") + 1
        : 0;
    const remain =
      dayjs(today).diff(item.start_date, "day") >= 0
        ? dayjs(item.end_date).diff(dayjs(today), "day")
        : dayjs(item.end_date).diff(dayjs(item.start_date), "day") + 1;
    await db.execute(
      `UPDATE locker SET used=${used}, remain=${remain} WHERE idx=${item.idx} `
    );
  }
  const zeroIdxs = await db
    .execute(
      `SELECT idx, start_date, end_date FROM locker WHERE end_date<'${today}'||deleted_time IS NOT NULL`
    )
    .then((result) => result[0]);
  for (const item of zeroIdxs) {
    const used = dayjs(item.end_date).diff(dayjs(item.start_date), "day") + 1;
    await db.execute(
      `UPDATE locker SET used=${used}, remain=${-1} WHERE idx=${item.idx} `
    );
  }
}

// 만료 1,3,7,15,30일 전 카카오 알림톡 발송
export async function remain3Days() {
  const days = [1, 3, 7, 15, 30];
  const kakaoList = [];
  for (const day of days) {
    const lockerList = await db
      .execute(
        `SELECT customer.user_idx AS user_idx, customer.name AS customer_name, customer.phone AS customer_phone, store.name AS store_name, store.contact AS store_contact, locker.locker_type AS locker_type, locker.locker_number AS locker_number, locker.end_date AS end_date 
         FROM talk_dday 
         JOIN locker_type ON talk_dday.locker_type_idx = locker_type.idx 
         JOIN locker ON 
          locker_type.user_idx = locker.user_idx 
          AND locker_type.locker_type=locker.locker_type 
         JOIN customer ON locker.customer_idx = customer.idx 
         JOIN store ON locker.user_idx = store.user_idx 
         WHERE 
          talk_dday.dday=${day} 
          && talk_dday.deleted_time IS NULL 
          && locker_type.deleted_time IS NULL 
          && locker.remain=${day}`
      )
      .then((result) => result[0]);

    for (const customer of lockerList) {
      kakaoList.push(talkPush({ ...customer, dday: day }));
      console.log(customer);
    }
  }
  Promise.all(kakaoList);
}

// 라카 만료 기본 태그 추가 ( end_date가 어제인것 )
// 라카 미이용이면 미이용 태그 달고 ( start_date ~ end_date가 없는 것 회원 ),
export async function handleExpiredLocker() {
  console.log("라카 만료 체크 크론 시작");
  const today = dayjs().format("YYYY-MM-DD");
  const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD");
  const promises = [];

  // 라카 만료
  const yesterdayExpired = await db
    .query(
      `SELECT ANY_VALUE(user_idx) AS user_idx, customer_idx FROM locker WHERE end_date='${yesterday}' GROUP BY customer_idx`
    )
    .then((r) => r[0]);
  yesterdayExpired.forEach((row) =>
    promises.push(
      addTagToCustomer({
        tagName: "라카만료",
        user_idx: row.user_idx,
        customer_idx: row.customer_idx,
      })
    )
  );

  // 라카 미이용
  const lockerUnused = await db
    .query(
      `
      SELECT customer.idx, customer.user_idx, locker_idx, L.deleted_time
      FROM customer
      JOIN (
         SELECT *
         FROM tag_to_customer AS TTC
         JOIN (
           SELECT idx, name FROM tag WHERE tag.name='라카이용'
         ) AS T ON TTC.tag_idx = T.idx
       ) AS Sub ON Sub.customer_idx = customer.idx
      LEFT JOIN (
        SELECT L1.idx AS locker_idx, L1.customer_idx, L1.deleted_time
        FROM locker AS L1
        WHERE L1.start_date <= '${today}'
        AND L1.end_date >= '${today}'
            AND L1.deleted_time IS NULL
      ) AS L ON customer.idx = L.customer_idx
      GROUP BY customer.idx, locker_idx
      HAVING locker_idx IS NULL
      ORDER BY idx DESC, L.deleted_time DESC
  `
    )
    .then((r) => r[0]);
  // console.log(lockerUnused);
  lockerUnused.map((row) => {
    promises.push(
      addTagToCustomer({
        tagName: "라카미이용",
        user_idx: row.user_idx,
        customer_idx: row.idx,
      })
    );
    promises.push(
      removeTagToCustomer({
        tagName: "라카이용",
        user_idx: row.user_idx,
        customer_idx: row.idx,
      })
    );
  });

  const result = await Promise.all(promises);
  console.log("라카 만료 체크 크론 끝");
}

// 가맹점 유료회원 만료일 체크
// export async function checkUserGrade() {
//   const today = dayjs().format("YYYY-MM-DD");
//   const userList = await db
//     .execute(
//       `SELECT
//         user.idx
//       FROM user
//       WHERE user.grade=1
//         && (
//           SELECT end_date
//           FROM payment_history
//           WHERE
//             payment_history.user_idx = user.idx
//             AND payment_history.is_default = 0
//             AND payment_history.refund_idx IS NULL
//           ORDER BY payment_history.idx asc limit 1
//           ) < '${today}'
//       GROUP BY user.idx`
//     )
//     .then((result) => result[0]);
//   if (userList.length > 0) {
//     const userArr = userList.map((item) => item.idx);
//     await db.execute(`UPDATE user SET grade=0 WHERE idx in(${userArr})`);
//     await db.execute(
//       `UPDATE talk_dday SET deleted_time='${today}' WHERE user_idx in(${userArr}) && dday!=3`
//     );
//   }
//   return true;
// }

// 이용권 만료되면 무료 생성
export async function checkTicketExprie() {
  const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD");
  const now = dayjs().format("YYYY-MM-DD");
  const expires = await db
    .query(
      `SELECT GROUP_CONCAT(idx SEPARATOR ',') AS idxs, user_idx FROM payment_history WHERE end_date <= '${yesterday}' AND refund_idx IS NULL AND is_default=0 GROUP BY user_idx`
    )
    .then((r) => r[0]);
  console.log("익스파이어", expires);
  await Promise.all(
    expires.map(async ({ idxs, user_idx }) => {
      let log = {};
      const isTicketExist = await db
        .query(
          `SELECT idx, is_default, start_date, end_date FROM payment_history WHERE user_idx=${user_idx} AND start_date <= '${now}' AND (end_date >= '${now}' OR end_date IS NULL) AND idx NOT IN (${idxs}) AND refund_idx IS NULL`
        )
        .then((r) => r[0][0]);
      log.isTicketExist = isTicketExist;
      if (!isTicketExist) {
        const isFreeExist = await db
          .query(
            `SELECT idx FROM payment_history WHERE user_idx=${user_idx} AND start_date = '${now}' AND is_default=1`
          )
          .then((r) => r[0][0]);
        log.isFreeExist = isFreeExist;
        const afterTicket = await db
          .query(
            `SELECT start_date FROM payment_history WHERE user_idx=${user_idx} AND start_date > '${now}' AND idx NOT IN (${idxs}) AND refund_idx IS NULL ORDER BY start_date ASC LIMIT 1`
          )
          .then((r) => r[0][0]);
        log.afterTicket = afterTicket;
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
              user_idx,
              "무료",
              1,
              0,
              new Date(),
              dayjs().format("YYYY-MM-DD"),
              newEndDate,
            ]
          );
        }
        await db.execute(`UPDATE user SET grade=0 WHERE idx=${user_idx}`);
        await db.execute(
          `UPDATE talk_dday SET deleted_time='${now}' WHERE user_idx =${user_idx} && dday!=3`
        );
      }
      // console.log(user_idx, log);
    })
  );
  return true;
}
