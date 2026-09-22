    // ========== 判分核心 ==========
    const hasLogic =
      typeof problem.logic === 'string' && problem.logic.trim() !== '';

    if (inContest) {
      // ---------- 競賽判分 ----------
      const evalType = contestProblem.evalType || 'numeric';

      if (evalType === 'numeric' && type !== 'text') {
        return res.status(400).json({ success: false, message: 'This problem requires a numeric answer' });
      }
      if (evalType === 'image_model' && type !== 'image') {
        return res.status(400).json({ success: false, message: 'This problem requires a photo answer' });
      }

      submissionData.contestId = activeContest.id;

      // 讀取現況（含 solved）
      const resultDoc = await db
        .collection('contest_results')
        .findOne(
          { contestId: activeContest.id, username, problemId: pid },
          { projection: { wrongAttempts: 1, score: 1, solved: 1 } }
        );

      const alreadySolved = resultDoc?.solved === true;
      let currentScore = resultDoc?.score || 0;
      let isCorrect = false;
      let systemError = false;

      if (hasLogic) {
        // ---- 競賽 + 邏輯 ----
        const logicResult = executeCustomLogic(problem.logic, problem.ans, answer);

        if (logicResult.systemError) {
          submissionData.systemError = true;
          submissionData.comment = logicResult.comment;
          await db.collection('submissions').insertOne(submissionData);
          return res.status(200).json({
            success: true, subid: submissionData.subid,
            correct: false, systemError: true,
            message: 'Logic execution failed',
          });
        }

        const logicScore = logicResult.score;
        isCorrect = logicScore === 100;
        submissionData.marked = true;
        submissionData.correct = isCorrect;
        submissionData.comment = logicResult.comment;

        if (alreadySolved) {
          // 已 AC 過 → 分數不變
          currentScore = resultDoc.score;
          submissionData.score = currentScore;
          await db.collection('submissions').insertOne(submissionData);
          await db.collection('contest_results').updateOne(
            { contestId: activeContest.id, username, problemId: pid },
            { $set: { lastSubmissionTime: now } }
          );
        } else if (isCorrect) {
          // ⭐ 首次 AC：套用罰分
          const prevWrong = resultDoc?.wrongAttempts || 0;
          currentScore = Math.max(0, 100 * Math.pow(0.9, prevWrong));
          submissionData.score = currentScore;
          await db.collection('submissions').insertOne(submissionData);
          await db.collection('contest_results').updateOne(
            { contestId: activeContest.id, username, problemId: pid },
            { $set: { score: currentScore, solved: true, lastSubmissionTime: now } },
            { upsert: true }
          );
          await updateUserStats(db, username, pid, true);
        } else if (logicScore > 0) {
          // ⭐ Partial（logic 回傳部分分，未 solved）
          currentScore = Math.max(resultDoc?.score || 0, logicScore);
          submissionData.score = currentScore;
          await db.collection('submissions').insertOne(submissionData);
          await db.collection('contest_results').updateOne(
            { contestId: activeContest.id, username, problemId: pid },
            { $set: { score: currentScore, solved: false, lastSubmissionTime: now } },
            { upsert: true }
          );
        } else {
          // ⭐ WA
          currentScore = resultDoc?.score || 0;
          submissionData.score = currentScore;
          await db.collection('submissions').insertOne(submissionData);
          await db.collection('contest_results').updateOne(
            { contestId: activeContest.id, username, problemId: pid },
            {
              $inc: { wrongAttempts: 1 },
              $set: { lastSubmissionTime: now, solved: false },
              $setOnInsert: { score: 0 },
            },
            { upsert: true }
          );
        }

        return res.status(200).json({
          success: true, subid: submissionData.subid,
          correct: isCorrect, systemError: false,
          score: currentScore,
          message: 'Judged by custom logic',
        });
      }

      // ---- 競賽 + 無邏輯（數值比較）----
      if (evalType === 'numeric') {
        const ansStr = String(problem.ans).trim();
        if (!isValidNumericAnswer(ansStr)) {
          systemError = true;
        } else {
          const cmp = compareNumeric(ansStr, answer);
          isCorrect = cmp.correct;
          systemError = cmp.systemError;
        }

        if (!systemError) {
          if (alreadySolved) {
            currentScore = resultDoc.score;
            await db.collection('contest_results').updateOne(
              { contestId: activeContest.id, username, problemId: pid },
              { $set: { lastSubmissionTime: now } }
            );
          } else if (isCorrect) {
            // ⭐ 首次 AC：套用罰分
            const prevWrong = resultDoc?.wrongAttempts || 0;
            currentScore = Math.max(0, 100 * Math.pow(0.9, prevWrong));
            await db.collection('contest_results').updateOne(
              { contestId: activeContest.id, username, problemId: pid },
              { $set: { score: currentScore, solved: true, lastSubmissionTime: now } },
              { upsert: true }
            );
          } else {
            // ⭐ WA
            currentScore = resultDoc?.score || 0;
            await db.collection('contest_results').updateOne(
              { contestId: activeContest.id, username, problemId: pid },
              {
                $inc: { wrongAttempts: 1 },
                $set: { lastSubmissionTime: now, solved: false },
                $setOnInsert: { score: 0 },
              },
              { upsert: true }
            );
          }
        }
      }
      // evalType === 'image_model'：等人工批改

      submissionData.correct = isCorrect;
      submissionData.systemError = systemError;
      submissionData.score = currentScore;
    } else {
      // ---------- 非競賽判分（不變） ----------
      if (type === 'text') {
        let isCorrect = false;
        let systemError = false;

        if (hasLogic) {
          const logicResult = executeCustomLogic(problem.logic, problem.ans, answer);
          if (logicResult.systemError) {
            submissionData.systemError = true;
            submissionData.comment = logicResult.comment;
            await db.collection('submissions').insertOne(submissionData);
            return res.status(200).json({
              success: true, subid: submissionData.subid,
              correct: false, systemError: true,
              message: 'Logic execution failed',
            });
          }
          submissionData.marked = true;
          submissionData.score = logicResult.score;
          submissionData.comment = logicResult.comment;
          submissionData.correct = logicResult.score === 100;
          submissionData.systemError = false;
          await db.collection('submissions').insertOne(submissionData);
          if (submissionData.correct) await updateUserStats(db, username, pid, true);
          return res.status(200).json({
            success: true, subid: submissionData.subid,
            correct: submissionData.correct, systemError: false,
            score: submissionData.score,
            message: 'Judged by custom logic',
          });
        }

        const ansStr = String(problem.ans).trim();
        if (!isValidNumericAnswer(ansStr)) {
          systemError = true;
        } else {
          const cmp = compareNumeric(ansStr, answer);
          isCorrect = cmp.correct;
          systemError = cmp.systemError;
        }
        submissionData.correct = isCorrect;
        submissionData.systemError = systemError;
      }
    }