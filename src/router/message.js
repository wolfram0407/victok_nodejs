import dayjs from "dayjs";
import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";

import { body, query } from "express-validator";
import { db } from "../db/database.js";
import {
  isAuth,
  sendSms,
  listSmsDetail,
  talkPush,
  validate,
  upload,
  isAdminAuth,
  getRefuseList,
} from "../middleware/functions.js";
import { URI, config } from "../../config.js";

const router = express.Router();

const uploadMemory = multer({ storage: multer.memoryStorage() });
// 메세지 보내기
router.post(
  "/message",
  uploadMemory.array("images", 3),
  isAuth,
  [
    body("msg").trim().notEmpty().withMessage("메세지 내용을 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      let { is_ad, msg, rdate, rtime, images, title, sender } = req.body;
      let null_idxs = [];
      // console.log(images, req.files);

      // 이미지 처리
      if (images instanceof Array) {
        images = await Promise.all(
          [...new Set(images)].map(async (s, i) => {
            if (!s.endsWith("[object File]")) {
              const buffer = await fs.readFileSync(
                path.join(path.resolve(), s.replace(URI, ""))
              );
              return {
                buffer,
                filename: s.split("/").slice(-1)[0],
              };
            } else {
              null_idxs.push(i);
              return null;
            }
          })
        );
      } else {
        images = [];
      }
      let i = 0;
      req.files?.forEach?.((file) => {
        images[null_idxs[i] ?? i] = {
          buffer: file.buffer,
          filename: file.originalname,
        };
        i++;
      });

      // console.log("최조조조오", images);

      // 회원 폰번호 조회
      const customer_idxs = JSON.parse(req.body.customer_idxs ?? "[]");

      if (customer_idxs.length === 0) {
        res
          .status(400)
          .json({ message: "대상을 적어도 하나 이상 선택해주세요." });
        return;
      }

      let ad = "";
      if (is_ad && is_ad == 1) {
        ad = "&& agree_marketing = 1";
      }

      // 해당 유저의 폰번호 검색
      let customers = await db
        .execute(
          `SELECT name, phone FROM customer WHERE user_idx=${
            req.authorizedUser
          } && idx IN (${customer_idxs.join(",")}) ${ad}`
        )
        .then((result) => result[0]);

      // 알리고에서 수신 받을 수 있는 번호가 아니면, error_cnt는 늘어나도 직접 보내지 않아서 나중에 조회할 수 없음.
      customers = customers.filter((c) =>
        /^(0[2-8][0-5]?|01[01346-9])-?([1-9]{1}[0-9]{2,3})-?([0-9]{4})$/.test(
          c.phone
        )
      );
      const phones = customers.map((v) => v.phone);
      const names = customers.map((v) => v.name);
      
//      console.log(phones, customers);

      if (ad && phones?.length === 0) {
        res.status(400).json({
          message: "광고 수신이 가능한 대상을 적어도 하나 이상 선택해주세요.",
        });
        return;
      }

      const payload = {
        msg,
        ...(!rdate && rdate != "null" && { rdate }),
        ...(!rtime && rtime != "null" && { rtime }),
        images,
        phones,
        title,
        sender,
      };
      // throw Error("ㅋㅋ");
      let result = await sendSms(payload);
      if (result && result.result_code == -103) {
        result = await sendSms({ ...payload, sender: config.aligo.sender });
      }
      if (result && result.result_code > 0) {
        const mid = result.msg_id;
        const success_cnt = result.success_cnt;
        const cnt = success_cnt + result.error_cnt;
        const is_reserve = Boolean(rdate || rtime);
        const type = result.msg_type.toUpperCase();
        const charges = await db
          .query(`SELECT * FROM message_setting WHERE idx=1`)
          .then((r) => r[0][0]);
        const charge =
          (success_cnt * charges[type.toUpperCase()]) / charges.divide;
        // const charge = cnt * config.aligo.price[type];
        const insertId = await db
          .execute(
            `INSERT INTO message (mid, user_idx, is_ad, is_reserve, type, cnt, msg, title, success_cnt, charge, names, phones, img_cnt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              mid,
              req.authorizedUser,
              is_ad == 1 ? 1 : 0,
              is_reserve,
              type,
              cnt,
              msg,
              title ? title : null,
              success_cnt,
              charge,
              names.join("|"),
              phones.join("|"),
              images.length,
            ]
          )
          .then((r) => r[0].insertId);

        // 72시간 후 성공 내역 표시
        setTimeout(() => {
          listSmsDetail({ mid, page_size: 500 }).then(({ list }) => {
            if (!list) return;
            const success_cnt = list.reduce(
              (acc, cur) => (cur.sms_state == "발송완료" ? acc + 1 : acc),
              0
            );
            const charge =
              (success_cnt * charges[type.toUpperCase()]) / charges.divide;
            db.execute(
              "UPDATE message SET success_cnt=?, charge=?, is_done=? WHERE idx=?",
              [success_cnt, charge, 1, insertId]
            );
          });
        }, 72 * 60 * 60 * 1000);

        res.sendStatus(204);
      } else {
        // 실패
        res
          .status(500)
          .json({ message: "관리자에게 문의해 주세요.", ...result });
      }
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 메세지 전송 내역 불러오기
router.get("/message-list", isAuth, async (req, res) => {
  const amount = 10;
  try {
    const {
      start_date,
      end_date,
      type,
      is_ad,
      column,
      order,
      keyword,
      page = 1,
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
        SELECT M.idx, M.mid, M.created_time, M.is_ad, M.type, M.is_reserve, M.cnt, M.msg, M.success_cnt, M.charge, S.name AS store_name, M.user_idx, M.img_cnt, M.is_done, M.title
        FROM message AS M
        LEFT JOIN store AS S ON S.user_idx = M.user_idx
        WHERE M.user_idx=${req.authorizedUser} ${whereBlock} 
        ${orderBlock}
        LIMIT ${amount} OFFSET ${amount * (page - 1)}`
      )
      .then((result) => result[0]);

    const total = await db
      .query(
        `SELECT count(M.idx) AS total 
            FROM message AS M
            LEFT JOIN store AS S ON S.user_idx = M.user_idx
            WHERE M.user_idx=${req.authorizedUser} ${whereBlock}`
      )
      .then((result) => result[0][0].total);

    return res.status(200).json({ total, list });
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

// 보낸 메세지 전송 상세 결과 조회
router.get(
  "/message-result",
  isAuth,
  [
    query("idx").trim().notEmpty().withMessage("메세지 idx를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { idx, page = 1, user_idx } = req.query;
      const message = await db
        .execute(`SELECT mid, cnt FROM message WHERE idx=${idx}`)
        .then((r) => r[0][0]);
      if (!message) {
        res.status(404).json({ message: "해당 메세지가 존재하지 않습니다." });
        return;
      }

      const aligoResult = await listSmsDetail({ mid: message.mid, page });
      if (aligoResult && aligoResult.result_code > 0) {
        if (aligoResult.list.length === 0) {
          res.status(200).json({ list: [], total: message.cnt, page });
          return;
        }
        const queryResult = await db
          .execute(
            `SELECT idx, name, phone, agree_marketing FROM customer WHERE phone IN (${aligoResult.list
              .map((v) => `'${v.receiver}'`)
              .join(",")}) && user_idx = ${
              user_idx ? user_idx : req.authorizedUser
            } && deleted_time IS NULL`
          )
          .then((r) => r[0]);
        queryResult.forEach((r) => {
          const i = aligoResult.list.findIndex((v) => v.receiver == r.phone);
          const obj = aligoResult.list[i];
          // console.log(obj);
          if (i >= 0) {
            obj.idx = r.idx;
            obj.agree_marketing = r.agree_marketing;
            obj.name = r.name;
          }
        });

        const list = aligoResult.list.map(
          ({ name, sms_state, agree_marketing, receiver }, i) => {
            let state = "실패";
            if (sms_state == "발송완료") state = "성공";
            else if (sms_state == "전송중") state = "전송중";
            return {
              i,
              name,
              agree_marketing: agree_marketing ? "Y" : "F",
              phone: receiver,
              state,
              description: sms_state,
            };
          }
        );
        // console.log("리스트", list);
        res.status(200).json({ list, total: message.cnt, page });
      } else {
        // 실패
        res.status(500).json(aligoResult);
      }
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 메세지 템플릿 저장
router.post(
  "/message-template",
  upload.array("images", 3),
  isAuth,
  [
    body("msg").trim().notEmpty().withMessage("메세지 내용을 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const cnt = await db
        .execute(
          `SELECT count(idx) as cnt FROM message_template WHERE user_idx=${req.authorizedUser}`
        )
        .then((r) => r[0][0].cnt);

      if (cnt >= 10) {
        res
          .status(409)
          .json({ message: "메세지는 10개를 초과하여 저장할 수 없습니다." });
        return;
      }

      const images = req.files?.map((f) => f.filename);
      const { msg } = req.body;

      await db.execute(
        `INSERT INTO message_template (user_idx, msg, images) VALUES (?,?,?)`,
        [req.authorizedUser, msg, images ?? null]
      );
      res.sendStatus(204);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 메세지템플릿목록 조회
router.get("/message-template-list", isAuth, async (req, res) => {
  try {
    const list = await db
      .execute(
        `SELECT idx, msg, images FROM message_template WHERE user_idx = ${req.authorizedUser}`
      )
      .then((r) => r[0]);

    for (let template of list) {
      try {
        const images = JSON.parse(template.images);
        if (images?.length > 0) {
          template.images = images.map(
            (image) => `${URI ? URI : "http://localhost:4000"}/uploads/${image}`
          );
        }
      } catch (e) {
        template.images = [];
      }
    }

    res.status(200).json(list);
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

// 메세지 템플릿 단일조회
router.get(
  "/message-template",
  isAuth,
  [
    query("idx").trim().notEmpty().withMessage("idx를 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      const { idx } = req.query;

      const template = await db
        .execute(
          `SELECT idx, msg, images FROM message_template WHERE idx = ${idx} && user_idx = ${req.authorizedUser}`
        )
        .then((r) => r[0][0]);

      if (!template) {
        res.status(404).json({ message: "해당 템플릿이 존재하지 않습니다." });
        return;
      }
      try {
        const images = JSON.parse(template.images);
        if (images?.length > 0) {
          template.images = images.map(
            (image) => `${URI ? URI : "http://localhost:4000"}/uploads/${image}`
          );
        }
      } catch (e) {
        template.images = [];
      }

      res.status(200).json(template);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

// 메세지 템플릿 삭제
router.post(
  "/message-template-delete",
  isAuth,
  [body("idxs").notEmpty().withMessage("idx 배열을 입력해 주세요."), validate],
  async (req, res) => {
    try {
      let { idxs } = req.body;
      if (!idxs || idxs.length === 0) {
        res.status(400).json({ message: "idx 배열을 입력해 주세요." });
        return;
      }
      const idxStrings = idxs.map((idx) => `'${idx}'`).join(",");
      const result = await db
        .execute(
          `SELECT idx FROM message_template WHERE user_idx=${req.authorizedUser} && idx IN (${idxStrings})`
        )
        .then((r) => r[0].map((v) => v.idx));

      if (result.length <= 0) {
        res.status(404).json({ message: "해당 템플릿이 존재하지 않습니다." });
        return;
      }

      await db.execute(
        `DELETE FROM message_template WHERE idx IN (${result
          .map((idx) => `'${idx}'`)
          .join(",")})`
      );
      res.sendStatus(204);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

router.get("/message-setting", isAuth, async (req, res) => {
  try {
    const result = await db
      .query(`SELECT * FROM message_setting WHERE idx=1`)
      .then((r) => r[0][0]);
    result.SMS /= result.divide;
    result.LMS /= result.divide;
    result.MMS /= result.divide;
    result.deny_number = (await getRefuseList(0)).deny_number;
    res.status(200).json(result);
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

router.post(
  "/message-setting",
  isAdminAuth,
  [
    body("sms").notEmpty().withMessage("SMS 가격을 입력해 주세요."),
    body("lms").notEmpty().withMessage("LMS 가격을 입력해 주세요."),
    body("mms").notEmpty().withMessage("MMS 가격을 입력해 주세요."),
    validate,
  ],
  async (req, res) => {
    try {
      let { sms, lms, mms } = req.body;

      let divide = await db
        .query("SELECT divide FROM message_setting WHERE idx=1")
        .then((r) => r[0][0]?.divide);
      if (!divide) {
        divide = 10;
      }

      sms = parseInt(sms * divide);
      lms = parseInt(lms * divide);
      mms = parseInt(mms * divide);

      await db.execute(
        `UPDATE message_setting SET SMS=?, LMS=?, MMS=? WHERE idx=1`,
        [sms, lms, mms]
      );
      res.sendStatus(204);
    } catch (e) {
      console.log(e);
      res.sendStatus(500);
    }
  }
);

export default router;
