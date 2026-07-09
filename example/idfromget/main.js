// Starting API
var urls = window.location.search.substring(1).split('&');
var cod = null;
var mode = null;

for (var i = 0; i < urls.length; i++) {
	var parameter = urls[i].split('=');

	if (parameter[0] == 'cod')
		cod = parameter[1];
	else if (parameter[0] == 'mode')
		mode = parameter[1];
}

if (cod === '' || cod == null)
	cod = 0;

cod = parseInt(cod, 10);
if (isNaN(cod))
	cod = 0;

startAPI(cod, '../../');

// Insert your logic here
function APIready(dados){
	$('#location').html(arrLocations[cod].name);
	for (var i = 0; i < dados.length; i++) {
		$('#list').append('<li>dia: ' + dados[i].day + ' - data: ' + dados[i].date + ' - medicao1: ' + dados[i].hour1 + ' altua1: ' + dados[i].height1 + ' - medicao2: ' + dados[i].hour2 + ' altua2: ' + dados[i].height2 + ' - medicao3: ' + dados[i].hour3 + ' altua3: ' + dados[i].height3 + ' - medicao4: ' + dados[i].hour4 + ' altua4: ' + dados[i].height4 + '</li>');
	}
	console.log('mode:', mode, 'cod:', cod, dados);
}
