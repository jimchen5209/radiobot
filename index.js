var Telegram = require('telegram-bot-api');
var Queue = require('queue');
var spawn = require('child_process').spawn;
var urlRegex = require('url-regex');

var TOKEN = '310584222:AAEwab47dpPjaGcmybMlDea7rzq41pTzQxs';

function doBroadcast(url, chat_id, msg_id) {
	return function (cb) {
		var ffmpeg = spawn('ffmpeg', ['-re', '-i', url, '-ac', '2', '-ar', '44100', '-acodec', 'pcm_u16le', '-t', '900', '-f', 'u16le', 'tcp://127.0.0.1:5000']);

		ffmpeg.stdout.resume();
		ffmpeg.stderr.pipe(process.stderr);

		ffmpeg.on('error', function (e) {
			cb(e);
			if (chat_id && msg_id) {
				bot.sendMessage({
					chat_id: chat_id,
					reply_to_message_id: msg_id,
					text: "Oops! There are errors and your song isn't played."
				});
			}
		});

		ffmpeg.on('exit', function (code) {
			if (code == 0) {
				setTimeout(function () {
					cb();
				}, 1000);
			} else {
				cb(code);
				if (chat_id && msg_id) {
					bot.sendMessage({
						chat_id: chat_id,
						reply_to_message_id: msg_id,
						text: "Oops! There are errors and your song isn't played."
					});
				}
			}
		});
	};
};

function doTTS(text) {
	var url = "https://translate.google.com/translate_tts?ie=UTF-8&q=" + encodeURIComponent(text) + "&tl=en-GB&client=tw-ob";
	return doBroadcast(url);
};

function doQueueSong(file, ttsText, chat_id, msg_id) {
	bot.getFile({ file_id: file }).then(function (data) {
		var url = 'https://api.telegram.org/file/bot' + TOKEN + '/' + data.file_path;
		queue.push(doTTS(ttsText));
		queue.push(doBroadcast(url, chat_id, msg_id));
		queue.start();

		bot.sendMessage({
			chat_id: chat_id,
			reply_to_message_id: msg_id,
			text: "Your music is scheduled to play. Use /queue to see how many songs you need to wait."
		});
	}).catch(function (e) {
		bot.sendMessage({
			chat_id: chat_id,
			reply_to_message_id: msg_id,
			text: "Oops! The file size seems larger than 20MB and I can't get it from Telegram."
		});
	});
};

function isCmd(text, cmd) {
	return text.indexOf('/' + cmd) == 0 ? true : false;
};

var queue = Queue({ concurrency: 1 });
queue.on('error', function () { });

var songList = [];
function addToSongList(file, name, title, artist) {
	if (songList.length >= 20) songList.splice(0, 1);
	songList.push({
		file: file,
		name: name,
		isURL: urlRegex({ exact: true }).test(file),
		title: title || null,
		artist: artist || null
	});
};

// Activate the TCP helper
require('./tcp_helper');

// Timed shows
require('./timed_broadcast')(queue, doTTS, doBroadcast);

var bot = new Telegram({
	token: TOKEN,
	updates: { enabled: true }
});

bot.on('message', function (data) {
	var chat_id = data.chat.id;
	var msg_id = data.message_id;
	var name = data.chat.first_name;
	var text = data.text || "";

	if (data.chat.type != 'private') {
		return;
	}

	if (isCmd(text, 'start')) {
		bot.sendMessage({
			chat_id: chat_id,
			reply_to_message_id: msg_id,
			text: "Welcome! I'm the DJ of Licson's Internet Radio. Just send me a song or a direct link to get your song played on https://licson.net/radio/ !"
		});
		return;
	}

	if (isCmd(text, 'queue')) {
		var realQueueLength = queue.length % 2 == 0 ? queue.length / 2 : (queue.length - 1) / 2;

		bot.sendMessage({
			chat_id: chat_id,
			reply_to_message_id: msg_id,
			text: "There are " + realQueueLength + " songs in the queue. " + (realQueueLength > 20 ? "I'm quite busy right now, please find me again after, like, 30 minutes." : "")
		});
		return;
	}

	if (isCmd(text, 'list')) {
		var output = "Recent songs: \n";

		songList.forEach(function (item, i) {
			output += "/song_" + (i + 1) + " uploaded by " + item.name + ". \n";
		});

		bot.sendMessage({
			chat_id: chat_id,
			reply_to_message_id: msg_id,
			text: output
		});
		return;
	}

	if (queue.length > 40) {
		bot.sendMessage({
			chat_id: chat_id,
			reply_to_message_id: msg_id,
			text: "I'm quite busy playing songs right now, please find me again after, like, 30 minutes."
		});
		return;
	}

	if (isCmd(text, 'song_')) {
		var index = parseInt(text.replace('/song_', '')) - 1;

		if (!songList[index]) return;

		var ttsText = "Next song is from " + songList[index].name + ", picked up by " + name + " on Telegram.";

		if (songList[index].title && songList[index].artist) {
			ttsText = "Next song is " + songList[index].title + " performed by " + songList[index].artist + " from " + songList[index].name + ", picked up by " + name + " on Telegram.";
		}

		if (songList[index].isURL) {
			queue.push(doTTS(ttsText));
			queue.push(doBroadcast(songList[index].file, chat_id, msg_id));
			queue.start();

			bot.sendMessage({
				chat_id: chat_id,
				reply_to_message_id: msg_id,
				text: "Your music is scheduled to play. Use /queue to see how many songs you need to wait."
			});
		} else {
			doQueueSong(songList[index].file, ttsText, chat_id, msg_id);
		}
	}

	if (data.audio) {
		var title = data.audio.title || null;
		var artist = data.audio.performer || null;
		var ttsText = "Next song is from " + name + " on Telegram.";

		if (artist && title) {
			ttsText = "Next is " + title + " performed by " + artist + " from " + name + " on Telegram.";
		}

		doQueueSong(data.audio.file_id, ttsText, chat_id, msg_id);
		addToSongList(data.audio.file_id, name, title, artist);
	} else if (data.document) {
		var ttsText = "Next song is from " + name + " on Telegram.";
		doQueueSong(data.document.file_id, ttsText, chat_id, msg_id);
		addToSongList(data.document.file_id, name);
	} else if (urlRegex({ exact: true }).test(text)) {
		var ttsText = "Next song is from " + name + " on Telegram.";
		queue.push(doTTS(ttsText));
		queue.push(doBroadcast(text, chat_id, msg_id));
		queue.start();

		bot.sendMessage({
			chat_id: chat_id,
			reply_to_message_id: msg_id,
			text: "Your music is scheduled to play. Use /queue to see how many songs you need to wait."
		});

		addToSongList(text, name);
	}
});
