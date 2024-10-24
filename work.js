import dayjs from "dayjs";
import { db } from "./src/db/database.js";
import { addTagToCustomer } from "./src/middleware/functions.js";
const formatDate = (date) => dayjs(date).format("YYYY-MM-DD");

const insertFreeHistory = async ({ userIdx, start_date, end_date }) => {
  await db.execute(
    "INSERT INTO payment_history (user_idx, payment_name, is_default, amount, paid_time, start_date, end_date) VALUES (?,?,?,?,?,?,?)",
    [userIdx, "무료", 1, 0, start_date, start_date, end_date]
  );
};

async function makeFreeHistories() {
  const userIdxs = await db
    .query("SELECT DISTINCT user_idx FROM payment_history")
    .then((r) => r[0].map(({ user_idx }) => user_idx));

  // 여기는 이용권 잇는 사람들 처리
  await Promise.all(
    userIdxs.map(async (userIdx) => {
      const histories = await db
        .query(`SELECT * FROM payment_history WHERE user_idx = ${userIdx}`)
        .then((r) => r[0]);
      const created_time = formatDate(
        await db
          .query(`SELECT created_time FROM user WHERE idx=${userIdx}`)
          .then((r) => r[0][0].created_time)
      );
      let prevEndDate;
      for (let i = 0; i < histories.length; i++) {
        const history = histories[i];
        let start_date = formatDate(history.start_date),
          end_date = formatDate(history.end_date);
        if (history.refund_idx) {
          let prevRefund = await db
            .query(
              `SELECT * FROM payment_refund WHERE idx=${history.refund_idx}`
            )
            .then((r) => r[0][0]?.refund_time);
          end_date = formatDate(prevRefund ?? end_date);
        }

        await insertFreeHistory({
          userIdx,
          start_date: prevEndDate
            ? dayjs(prevEndDate).add(1, "day").format("YYYY-MM-DD")
            : created_time,
          end_date:
            i === histories.length - 1 && i !== 0
              ? null
              : dayjs(start_date).subtract(1, "day").format("YYYY-MM-DD"),
        });
        prevEndDate = end_date;
      }
      return;
    })
  );

  // 여기는 없는 사람들 처리
  const users = await db
    .query(
      `SELECT idx, created_time FROM user WHERE idx NOT IN (${userIdxs.join(
        ","
      )})`
    )
    .then((r) => r[0]);
  console.log(users);
  await Promise.all(
    users.map(async (user) =>
      insertFreeHistory({
        userIdx: user.idx,
        start_date: formatDate(user.created_time),
        end_date: null,
      })
    )
  );
}

async function makeDefaultTagType() {
  const users = await db.query("SELECT idx FROM user").then((r) => r[0]);
  for (let user of users) {
    await db.execute("INSERT INTO tag_type (user_idx, name) VALUES (?,?)", [
      user.idx,
      "기본",
    ]);
  }
}

/**
 * 태그들 관리
 * 일단 커스토머 하나하나 순회할것임
 * 체크해야할 것들
 * 1. 유저의 기본 태그 타입의 idx => dtt_idx ( = dtts_map[user_idx] )
 * 2. 해당 태그의 idx (없으면 만들기) => tag_idx
 * 3. 커스토머의 idx => customer_idx
 * 4. 라카 이용 여부
 * 5. 라카 이용이라면 이용중인 라카 구분으로 만든 태그 연결
 * 6. 라카 만료 여부
 * 7. 라카비 미납 여부
 * 8. 지공차트 이용 여부
 * 9. 성별 여부 ( 이건 안함 )
 * 10. 출생년도 ( 이건 안함 )
 * 11. 출생월 ( 이건 안함 )
 */

async function makeTags() {
  const allCustomers = await db
    .query("SELECT idx, user_idx FROM customer WHERE deleted_time IS NULL")
    .then((r) => r[0]);
  const dtts = await db
    .query("SELECT * FROM tag_type WHERE name = '기본'")
    .then((r) => r[0]);
  const dtts_map = {};
  dtts.forEach((dtt) => {
    dtts_map[dtt.user_idx] = dtt.idx;
  });
  const now = dayjs();
  for (let index = 0; index < allCustomers.length; index++) {
    const customer = allCustomers[index];
    try {
      const lockers = await db
        .query(
          `SELECT idx, paid, locker_type, start_date, end_date FROM locker WHERE deleted_time IS NULL AND customer_idx=${customer.idx}`
        )
        .then((r) => r[0]);
      const currentLockers = lockers.filter(
        (item) =>
          dayjs(item.end_date).add(1, "day").startOf("day").isAfter(now) &&
          dayjs(item.start_date).subtract(1, "day").endOf("day").isBefore(now)
      );

      // 라커 이용 여부
      if (currentLockers.length > 0) {
        await addTagToCustomer({
          customer_idx: customer.idx,
          tagName: "라카이용",
          user_idx: customer.user_idx,
          defaultTagTypeIdx: dtts_map[customer.user_idx],
        });

        // 라커 타입에 따른 태그 추가.
        for (let locker of currentLockers) {
          await addTagToCustomer({
            customer_idx: customer.idx,
            tagName: locker.locker_type,
            user_idx: customer.user_idx,
            defaultTagTypeIdx: dtts_map[customer.user_idx],
          });
        }
      } else {
        await addTagToCustomer({
          customer_idx: customer.idx,
          tagName: "라카미이용",
          user_idx: customer.user_idx,
          defaultTagTypeIdx: dtts_map[customer.user_idx],
        });
      }

      // 라커 미수납 여부
      const isUnPaidExist =
        currentLockers.find((item) => item.paid == "미수납") != null;
      if (isUnPaidExist) {
        await addTagToCustomer({
          customer_idx: customer.idx,
          tagName: "라카비미납",
          user_idx: customer.user_idx,
          defaultTagTypeIdx: dtts_map[customer.user_idx],
        });
      }

      // 라커 만료 여부
      const olderLockers =
        lockers.find((item) =>
          dayjs(item.end_date).isBefore(now.add(1, "day").startOf("day"))
        ) != null;
      if (olderLockers && currentLockers.length === 0) {
        await addTagToCustomer({
          customer_idx: customer.idx,
          tagName: "라카만료",
          user_idx: customer.user_idx,
          defaultTagTypeIdx: dtts_map[customer.user_idx],
        });
      }

      const isDrillingChartExist = await db
        .query(
          `SELECT idx FROM drilling_chart WHERE deleted_time IS NULL AND customer_idx=${customer.idx}`
        )
        .then((r) => r[0][0]);
      if (isDrillingChartExist) {
        await addTagToCustomer({
          customer_idx: customer.idx,
          tagName: "지공차트이용",
          user_idx: customer.user_idx,
          defaultTagTypeIdx: dtts_map[customer.user_idx],
        });
      } else {
        await addTagToCustomer({
          customer_idx: customer.idx,
          tagName: "지공차트미이용",
          user_idx: customer.user_idx,
          defaultTagTypeIdx: dtts_map[customer.user_idx],
        });
      }
      console.log(index, "---");
    } catch (e) {
      console.log("@@@", customer, index, "에서 에러");
      console.log(e);
    }
  }
  console.log("DONE!!!");
}

makeTags();
